/**
 * Scan Context Factory
 *
 * Creates the shared context object passed through all scan steps.
 * Each step reads from and writes to this context — no return value merging needed.
 * Plain objects and functions only — no classes.
 */

/**
 * Create a new scan context
 * @param {number} auditId - Database audit ID
 * @param {string} auditUid - Audit unique identifier
 * @param {string} websiteUrl - URL being scanned
 * @returns {Object} Shared context object
 */
function createScanContext(auditId, auditUid, websiteUrl) {
  return {
    // Identity
    auditId,
    auditUid,
    websiteUrl,

    // Browser resources (set by stepBrowserLaunch)
    browser: null,
    page: null,

    // Monitoring (set by stepInjectMonitoring)
    networkMonitor: null,

    // Cookie snapshots (set by cookie steps)
    baselineCookies: [],
    baselineTime: 0,
    intermediateCookies: [],
    intermediateTime: 0,
    cookies: [],
    cookieStats: null,
    trackingCookies: [],

    // Banner detection (set by stepBannerDetection)
    bannerAppearTime: null,

    // Network data (set by stepPreliminaryNetworkStats, reassigned by stepNetworkCategorization)
    trackingRequests: [],
    trackingBeforeConsentRequests: [],

    // Tracking analysis (set by stepClientSideTracking)
    trackingData: null,
    trackingAnalysis: null,

    // Banner analysis (set by stepBannerCompliance)
    bannerAnalysis: null,

    // Consent monitoring (set by stepConsentMonitorData)
    monitoringData: null,
    monitoringAnalysis: null,
    detectedVendors: [],
    vendorSummary: null,

    // Consent mode (set by stepConsentModeDetection, enriched by stepConsentModeValidation)
    consentModeAudit: null,

    // Page metadata (set by stepPageMetadata)
    metadata: null,

    // Timeline (set by stepTimelineConstruction)
    timeline: null,
    timelineReport: null,

    // Request categorization (set by stepNetworkCategorization)
    requestCategorization: null,
    trackingSummary: null,

    // Network-storage correlation (set by stepNetworkStorageCorrelation)
    networkStorageCorrelations: null,

    // Screenshots (currently disabled)
    screenshotUrls: {},

    // Banner incognito cookie context (set by stepBannerCompliance / analyzeCookieBanner)
    // Used to merge with main context cookies for type_i misclassification check
    bannerContextCookies: [],

    // Consent simulation (set by stepConsentSimulation)
    consentSimulation: null,

    // Compliance score (set by stepComplianceScore)
    complianceScore: null,

    // Scan metadata
    scanDuration: 0,
    startTime: Date.now(),

    // Error tracking
    errors: []
  };
}

module.exports = {
  createScanContext
};
