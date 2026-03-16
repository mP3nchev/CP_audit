/**
 * Sample scan results fixtures for confirmed-tracking-filter.js and
 * compliance-score-calculator.js tests.
 *
 * All shapes verified against source:
 *   - confirmed-tracking-filter.js: expects (networkRequests, requestCategorization)
 *   - compliance-score-calculator.js: expects auditResults object
 *   - network-monitor.js: request shape
 *   - network-request-categorizer.js: categorization output shape
 */

'use strict';

// ─── Network Requests (raw, from network_requests_json) ─────────────

const sampleNetworkRequests = [
  // Category A tracking — before consent
  {
    url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXX&cid=123.456&t=pageview',
    method: 'GET',
    resourceType: 'xhr',
    timestamp: 0.3,
    beforeConsent: true,
    isTracking: true,
    domain: 'www.google-analytics.com',
    responseStatus: 200,
    headers: {}
  },
  // Category A tracking — before consent
  {
    url: 'https://www.facebook.com/tr?id=111&ev=PageView&noscript=1&cd[page]=test',
    method: 'GET',
    resourceType: 'image',
    timestamp: 0.5,
    beforeConsent: true,
    isTracking: true,
    domain: 'www.facebook.com',
    responseStatus: 200,
    headers: {}
  },
  // Category B — suspicious but not definite
  {
    url: 'https://cdn.example.com/analytics.js?v=1',
    method: 'GET',
    resourceType: 'script',
    timestamp: 0.2,
    beforeConsent: true,
    isTracking: false,
    responseStatus: 200,
    headers: {}
  },
  // Benign — same-origin API call
  {
    url: 'https://example.com/api/data',
    method: 'GET',
    resourceType: 'xhr',
    timestamp: 1.0,
    beforeConsent: false,
    isTracking: false,
    responseStatus: 200,
    headers: {}
  },
  // Benign — CSS file (Category C)
  {
    url: 'https://example.com/style.css',
    method: 'GET',
    resourceType: 'stylesheet',
    timestamp: 0.1,
    beforeConsent: true,
    isTracking: false,
    responseStatus: 200,
    headers: {}
  },
  // After-consent tracking request (should NOT be Layer 3)
  {
    url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXX&cid=789&t=event',
    method: 'GET',
    resourceType: 'xhr',
    timestamp: 5.0,
    beforeConsent: false,
    isTracking: true,
    domain: 'www.google-analytics.com',
    responseStatus: 200,
    headers: {}
  },
  // Benign image (woff2 font)
  {
    url: 'https://fonts.gstatic.com/s/roboto/v30/font.woff2',
    method: 'GET',
    resourceType: 'font',
    timestamp: 0.15,
    beforeConsent: true,
    isTracking: false,
    responseStatus: 200,
    headers: {}
  }
];

// ─── Request Categorization (from network-request-categorizer.js) ────

const sampleRequestCategorization = {
  categoryA: {
    count: 2,
    requests: [
      { url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXX&cid=123.456&t=pageview', confidence: 85 },
      { url: 'https://www.facebook.com/tr?id=111&ev=PageView&noscript=1&cd[page]=test', confidence: 80 }
    ]
  },
  categoryB: {
    count: 1,
    requests: [
      { url: 'https://cdn.example.com/analytics.js?v=1', confidence: 50 }
    ]
  },
  categoryC: {
    count: 4,
    requests: [
      { url: 'https://example.com/api/data', confidence: 5 },
      { url: 'https://example.com/style.css', confidence: 0 },
      { url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXX&cid=789&t=event', confidence: 85 },
      { url: 'https://fonts.gstatic.com/s/roboto/v30/font.woff2', confidence: 0 }
    ]
  },
  trackingRequests: [
    { url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXX&cid=123.456&t=pageview', confidence: 85 },
    { url: 'https://www.facebook.com/tr?id=111&ev=PageView&noscript=1&cd[page]=test', confidence: 80 },
    { url: 'https://cdn.example.com/analytics.js?v=1', confidence: 50 }
  ]
};

// ─── Compliance Score Calculator Fixtures ────────────────────────────

/**
 * Full audit results — all components present (good compliance)
 * Input shape for calculateOverallScore(auditResults)
 */
const sampleAuditResultsFull = {
  policyAnalysis: {
    total_score: 85,
    max_score: 100,
    percentage: 85.0
  },
  bannerAnalysis: {
    bannerDetected: true,
    bannerDetectionStatus: { viewport: 'desktop' },
    totalChecks: 8,
    passedCount: 7,
    violationCount: 1,
    skippedCount: 0,
    hasCriticalViolations: false,
    violations: [
      { severity: 'warning', type: 'missing_reject_all' }
    ]
  },
  consentSimulation: {
    success: true,
    comparison: {
      clickImbalance: 1,
      violations: []
    }
  },
  scanResults: {
    tracking_before_consent: false,
    cookies: [{ name: '_ga' }, { name: 'session_id' }]
  },
  consentModeAnalysis: {
    detected: true,
    compliant: true,
    implementationScore: 90
  },
  cookieComparison: {
    accuracyScore: 80,
    matched: [{ name: '_ga' }],
    totalDetected: 2
  }
};

/**
 * Audit results with no privacy policy (weight redistribution test)
 */
const sampleAuditResultsNoPolicy = {
  policyAnalysis: null,
  bannerAnalysis: {
    bannerDetected: true,
    bannerDetectionStatus: { viewport: 'desktop' },
    totalChecks: 8,
    passedCount: 6,
    violationCount: 2,
    skippedCount: 0,
    hasCriticalViolations: false,
    violations: [
      { severity: 'warning', type: 'missing_reject_all' },
      { severity: 'warning', type: 'unclear_language' }
    ]
  },
  consentSimulation: null,
  scanResults: {
    tracking_before_consent: false,
    cookies: [{ name: 'session_id' }]
  },
  consentModeAnalysis: null,
  cookieComparison: {
    accuracyScore: 70,
    matched: [],
    totalDetected: 1
  }
};

/**
 * Audit results with maximum violations (low score test)
 */
const sampleAuditResultsWorst = {
  policyAnalysis: {
    total_score: 10,
    max_score: 100,
    percentage: 10.0
  },
  bannerAnalysis: {
    bannerDetected: true,
    bannerDetectionStatus: { viewport: 'desktop' },
    totalChecks: 8,
    passedCount: 1,
    violationCount: 7,
    skippedCount: 0,
    hasCriticalViolations: true,
    violations: [
      { severity: 'critical', type: 'no_reject_option' },
      { severity: 'critical', type: 'pre_checked_boxes' },
      { severity: 'warning', type: 'unclear_language' },
      { severity: 'warning', type: 'dark_patterns' },
      { severity: 'warning', type: 'no_granularity' },
      { severity: 'warning', type: 'forced_consent' },
      { severity: 'warning', type: 'no_withdraw' }
    ]
  },
  consentSimulation: {
    success: true,
    comparison: {
      clickImbalance: 5,
      violations: [{ type: 'asymmetry' }, { type: 'dark_pattern' }]
    }
  },
  scanResults: {
    tracking_before_consent: true,
    cookies: []
  },
  consentModeAnalysis: {
    detected: true,
    compliant: false,
    implementationScore: 20
  },
  cookieComparison: {
    accuracyScore: 10,
    matched: [],
    totalDetected: 15
  }
};

/**
 * Audit results with banner not detected
 */
const sampleAuditResultsNoBanner = {
  policyAnalysis: {
    total_score: 70,
    max_score: 100,
    percentage: 70.0
  },
  bannerAnalysis: {
    bannerDetected: false,
    bannerDetectionStatus: { viewport: null, found: false },
    totalChecks: 0,
    passedCount: 0,
    violationCount: 0,
    skippedCount: 0,
    hasCriticalViolations: false,
    violations: []
  },
  consentSimulation: null,
  scanResults: {
    tracking_before_consent: false,
    cookies: [{ name: 'session' }]
  },
  consentModeAnalysis: null,
  cookieComparison: null
};

/**
 * Audit results with mobile-only banner
 */
const sampleAuditResultsMobileOnlyBanner = {
  policyAnalysis: {
    total_score: 80,
    max_score: 100,
    percentage: 80.0
  },
  bannerAnalysis: {
    bannerDetected: true,
    bannerDetectionStatus: { viewport: 'mobile' },
    totalChecks: 8,
    passedCount: 7,
    violationCount: 1,
    skippedCount: 0,
    hasCriticalViolations: false,
    violations: [{ severity: 'warning', type: 'missing_info' }]
  },
  consentSimulation: null,
  scanResults: {
    tracking_before_consent: false,
    cookies: [{ name: 'consent_cookie' }]
  },
  consentModeAnalysis: null,
  cookieComparison: null
};

module.exports = {
  sampleNetworkRequests,
  sampleRequestCategorization,
  sampleAuditResultsFull,
  sampleAuditResultsNoPolicy,
  sampleAuditResultsWorst,
  sampleAuditResultsNoBanner,
  sampleAuditResultsMobileOnlyBanner
};
