/**
 * Scan Phase: Analysis (Steps 7–13.7)
 *
 * Handles cookie extraction, network stats, tracking detection,
 * banner compliance, consent monitoring, consent mode detection/validation,
 * page metadata, timeline, network categorization, and correlation.
 *
 * Each step reads from and writes to the shared context object.
 */

const {
  extractCookies,
  getCookieStats,
  findTrackingCookies
} = require('./cookie-extractor');

const {
  extractTrackingData,
  analyzeTracking
} = require('./tracking-detector');

const {
  analyzeCookieBanner
} = require('../analyzers/cookie-banner-checker');

const {
  auditConsentMode
} = require('../analyzers/consent-mode-detector');

const {
  buildTimeline,
  generateTimelineReport
} = require('../analyzers/timeline-builder');

const {
  categorizeRequests,
  getTrackingSummary
} = require('../analyzers/network-request-categorizer');

const {
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

const {
  getPageMetadata
} = require('./puppeteer-setup');

const { createLogger } = require('../utils/logger');

const logger = createLogger('phase-analysis');

// ─── Step 7: Final Cookie Extraction ──────────────────────────────
const stepFinalCookieExtraction = {
  name: 'stepFinalCookieExtraction',
  stepNumber: '7',
  critical: false,
  async execute(context) {
    // Extract final cookies WITH default 3s delay
    let cookies = await extractCookies(context.page);
    const finalTime = await context.page.evaluate(() => performance.now());

    // THREE-TIER timestamp assignment
    const baselineCookieNames = new Set(context.baselineCookies.map(c => c.name));
    const intermediateCookieNames = new Set(context.intermediateCookies.map(c => c.name));

    cookies = cookies.map(cookie => {
      let detectedAt, detectionStage;

      if (baselineCookieNames.has(cookie.name)) {
        detectedAt = context.baselineTime;
        detectionStage = 'baseline';
      } else if (intermediateCookieNames.has(cookie.name)) {
        detectedAt = context.intermediateTime;
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
        loadedBeforeBanner: context.bannerAppearTime && detectedAt < context.bannerAppearTime
      };
    });

    context.cookies = cookies;
    context.cookieStats = getCookieStats(cookies);
    context.trackingCookies = findTrackingCookies(cookies);

    const cookiesBeforeBanner = cookies.filter(c => c.loadedBeforeBanner);
    const trackingBeforeBanner = context.trackingCookies.filter(c => c.loadedBeforeBanner);

    logger.debug('scan-progress', { message: `Found ${cookies.length} cookies`, auditId: context.auditId });
    logger.debug('scan-progress', { message: `Tracking cookies: ${context.trackingCookies.length}`, auditId: context.auditId });
    logger.debug('scan-progress', { message: `Cookies before banner: ${cookiesBeforeBanner.length}`, auditId: context.auditId });
    logger.debug('scan-progress', { message: `TRACKING before banner: ${trackingBeforeBanner.length}`, auditId: context.auditId });
  }
};

// ─── Step 8: Preliminary Network Stats ────────────────────────────
const stepPreliminaryNetworkStats = {
  name: 'stepPreliminaryNetworkStats',
  stepNumber: '8',
  critical: false,
  async execute(context) {
    const networkStats = context.networkMonitor.getStats();
    context.trackingRequests = context.networkMonitor.getTrackingRequests();
    context.trackingBeforeConsentRequests = context.networkMonitor.getTrackingBeforeConsent();

    logger.debug('scan-progress', { message: `Total requests: ${networkStats.totalRequests}`, auditId: context.auditId });
    logger.debug('scan-progress', { message: `Tracking requests (preliminary): ${networkStats.trackingRequests}`, auditId: context.auditId });
    logger.debug('scan-progress', { message: `Tracking before consent (preliminary): ${networkStats.trackingBeforeConsent}`, auditId: context.auditId });
  }
};

// ─── Step 9: Client-Side Tracking Detection ───────────────────────
const stepClientSideTracking = {
  name: 'stepClientSideTracking',
  stepNumber: '9',
  critical: false,
  async execute(context) {
    context.trackingData = await extractTrackingData(context.page);
    context.trackingAnalysis = analyzeTracking(context.trackingData, context.cookies);
  }
};

// ─── Step 10: Banner Compliance ───────────────────────────────────
const stepBannerCompliance = {
  name: 'stepBannerCompliance',
  stepNumber: '10',
  critical: false,
  async execute(context) {
    context.bannerAnalysis = await analyzeCookieBanner(context.page, context.auditId, context.cookies);

    logger.debug('scan-progress', { message: `Violations found: ${context.bannerAnalysis.violationCount}/${context.bannerAnalysis.totalChecks}`, auditId: context.auditId });
    if (context.bannerAnalysis.skippedCount > 0) {
      logger.debug('scan-progress', { message: `Checks skipped: ${context.bannerAnalysis.skippedCount}`, auditId: context.auditId });
    }
    logger.debug('scan-progress', { message: `Critical violations: ${context.bannerAnalysis.hasCriticalViolations ? 'YES' : 'NO'}`, auditId: context.auditId });
  }
};

// ─── Step 10.4: Consent Monitor Data + Vendor Fingerprinting ──────
const stepConsentMonitorData = {
  name: 'stepConsentMonitorData',
  stepNumber: '10.4',
  critical: false,
  async execute(context) {
    try {
      context.monitoringData = await extractMonitoringData(context.page);

      if (context.monitoringData.initialized) {
        logger.debug('scan-progress', { message: `Consent monitor active: gtag=${context.monitoringData.gtagCalls.length}, dataLayer=${context.monitoringData.dataLayerEvents.length}, storage=${context.monitoringData.storageWrites.length}`, auditId: context.auditId });

        context.monitoringAnalysis = analyzeMonitoringData(context.monitoringData);

        // Extract vendor evidence
        const vendorEvidence = await extractVendorEvidence(context.page, context.networkMonitor.getRequests());
        vendorEvidence.monitorData = context.monitoringData;

        // Fingerprint vendors
        context.detectedVendors = fingerprintVendors(vendorEvidence);
        context.vendorSummary = generateVendorSummary(context.detectedVendors, context.monitoringData.consentState);

        logger.debug('scan-progress', { message: `Detected vendors: ${context.detectedVendors.length}`, auditId: context.auditId });
      } else {
        logger.debug('scan-progress', { message: 'Consent monitor not initialized - wrappers may have failed', auditId: context.auditId });
      }
    } catch (error) {
      logger.error('consent-monitoring-failed', {
        error: error.message,
        auditId: context.auditId,
        stack: error.stack
      });
    }
  }
};

// ─── Step 10.5: Consent Mode Detection ────────────────────────────
const stepConsentModeDetection = {
  name: 'stepConsentModeDetection',
  stepNumber: '10.5',
  critical: false,
  async execute(context) {
    context.consentModeAudit = await auditConsentMode(context.page, context.monitoringData);

    if (context.consentModeAudit.detected) {
      logger.debug('scan-progress', { message: `Consent Mode version: ${context.consentModeAudit.version || 'unknown'}, compliant: ${context.consentModeAudit.compliant}`, auditId: context.auditId });
    } else {
      logger.debug('scan-progress', { message: 'Consent Mode not detected', auditId: context.auditId });
    }
  }
};

// ─── Step 10.6: Consent Mode Validation ───────────────────────────
const stepConsentModeValidation = {
  name: 'stepConsentModeValidation',
  stepNumber: '10.6',
  critical: false,
  async execute(context) {
    const orderValidation = validateExecutionOrder(
      context.consentModeAudit,
      context.networkMonitor.getRequests().map(r => ({ url: r.url, timestamp: r.timestamp }))
    );

    if (!orderValidation.valid && !orderValidation.skipped) {
      logger.debug('scan-progress', { message: `Consent Mode execution order violation: ${orderValidation.violationType}`, auditId: context.auditId });
      context.consentModeAudit.executionOrderValidation = orderValidation;
      context.consentModeAudit.hasExecutionOrderViolation = true;
    } else {
      context.consentModeAudit.executionOrderValidation = orderValidation;
      context.consentModeAudit.hasExecutionOrderViolation = false;
    }
  }
};

// ─── Step 13: Page Metadata ───────────────────────────────────────
const stepPageMetadata = {
  name: 'stepPageMetadata',
  stepNumber: '13',
  critical: false,
  async execute(context) {
    context.metadata = await getPageMetadata(context.page);
  }
};

// ─── Step 13.5: Timeline Construction ─────────────────────────────
const stepTimelineConstruction = {
  name: 'stepTimelineConstruction',
  stepNumber: '13.5',
  critical: false,
  async execute(context) {
    const pageLoadTime = await context.page.evaluate(() => {
      return performance.timing.loadEventEnd - performance.timing.navigationStart;
    });

    context.timeline = buildTimeline({
      cookies: context.cookies,
      networkRequests: context.networkMonitor.getRequests(),
      pageLoadTime: pageLoadTime,
      bannerAppearTime: context.bannerAppearTime,
      consentTime: null
    });

    context.timelineReport = generateTimelineReport(context.timeline);

    logger.debug('scan-progress', { message: `Timeline: ${context.timeline.events.length} events, ${context.timeline.violations?.length || 0} violations`, auditId: context.auditId });
  }
};

// ─── Step 13.6: Network Categorization (CRITICAL) ─────────────────
const stepNetworkCategorization = {
  name: 'stepNetworkCategorization',
  stepNumber: '13.6',
  critical: true,
  async execute(context) {
    context.requestCategorization = categorizeRequests(context.networkMonitor.getRequests());
    context.trackingSummary = getTrackingSummary(context.requestCategorization);

    logger.debug('scan-progress', { message: `Categorization: A=${context.requestCategorization.categoryA.count}, B=${context.requestCategorization.categoryB.count}, C=${context.requestCategorization.categoryC.count}`, auditId: context.auditId });

    // CRITICAL: Replace boolean-flagged tracking arrays with re-categorized data
    context.trackingRequests = context.requestCategorization.trackingRequests;
    context.trackingBeforeConsentRequests = context.requestCategorization.trackingRequests.filter(r => r.beforeConsent);

    logger.debug('scan-progress', { message: `Tracking (re-categorized): ${context.trackingRequests.length}, before consent: ${context.trackingBeforeConsentRequests.length}`, auditId: context.auditId });
  }
};

// ─── Step 13.7: Network-Storage Correlation ───────────────────────
/**
 * correlateNetworkAndStorage — extracted from website-scanner.js
 * Correlates network tracking requests with storage writes within a time window.
 */
function correlateNetworkAndStorage(trackingRequests, monitoringData, requestCategorization) {
  const CORRELATION_WINDOW_MS = 1000;

  const correlatedViolations = [];
  const uncorrelatedNetwork  = [];

  const storageWrites = (monitoringData && Array.isArray(monitoringData.storageWrites))
    ? monitoringData.storageWrites
    : [];

  const categoryARequests = requestCategorization
    ? (requestCategorization.categoryA?.requests || [])
    : [];

  const candidateRequests = [
    ...trackingRequests,
    ...categoryARequests.filter(r => {
      return !trackingRequests.some(tr => tr.url === r.url);
    })
  ];

  for (const netReq of candidateRequests) {
    const netTimestamp = netReq.timestamp || 0;

    const matchingStorage = storageWrites.filter(write => {
      const writeTime = write.timestamp || 0;
      return Math.abs(writeTime - netTimestamp) <= CORRELATION_WINDOW_MS;
    });

    if (matchingStorage.length > 0) {
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
          type:      w.type || 'unknown',
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

const stepNetworkStorageCorrelation = {
  name: 'stepNetworkStorageCorrelation',
  stepNumber: '13.7',
  critical: false,
  async execute(context) {
    context.networkStorageCorrelations = correlateNetworkAndStorage(
      context.trackingBeforeConsentRequests,
      context.monitoringData,
      context.requestCategorization
    );

    logger.debug('scan-progress', { message: `Correlation: ${context.networkStorageCorrelations.correlatedViolations.length} correlated, confidence: ${context.networkStorageCorrelations.overallConfidence}%`, auditId: context.auditId });
  }
};

// Export ordered step array
const analysisSteps = [
  stepFinalCookieExtraction,
  stepPreliminaryNetworkStats,
  stepClientSideTracking,
  stepBannerCompliance,
  stepConsentMonitorData,
  stepConsentModeDetection,
  stepConsentModeValidation,
  stepPageMetadata,
  stepTimelineConstruction,
  stepNetworkCategorization,
  stepNetworkStorageCorrelation
];

module.exports = {
  analysisSteps,
  correlateNetworkAndStorage,
  stepFinalCookieExtraction,
  stepPreliminaryNetworkStats,
  stepClientSideTracking,
  stepBannerCompliance,
  stepConsentMonitorData,
  stepConsentModeDetection,
  stepConsentModeValidation,
  stepPageMetadata,
  stepTimelineConstruction,
  stepNetworkCategorization,
  stepNetworkStorageCorrelation
};
