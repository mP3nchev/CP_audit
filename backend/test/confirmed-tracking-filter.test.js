/*
 * FUNCTION UNDER TEST: buildMetricHierarchy, computeConfirmedTrackingViolations
 * SIGNATURES:
 *   buildMetricHierarchy(networkRequests, requestCategorization)
 *   computeConfirmedTrackingViolations(networkRequests, requestCategorization)
 * INPUT SHAPES:
 *   networkRequests: Array of { url, method, resourceType, timestamp, beforeConsent,
 *     isTracking, domain, responseStatus, headers }
 *   requestCategorization: { categoryA: { count, requests: [{url, confidence}] },
 *     categoryB: { count, requests }, categoryC: { count, requests }, trackingRequests }
 * OUTPUT (buildMetricHierarchy):
 *   { layer1: { count, label, legalStatus },
 *     layer2: { count, label, legalStatus },
 *     layer3: { count, label, legalStatus, isAuthoritative, requests },
 *     internalControl: { exposureRate, exposureRatePct, detectionPrecision, detectionPrecisionPct, _note },
 *     funnelExplanation: string }
 * OUTPUT (computeConfirmedTrackingViolations): Array of confirmed violation request objects
 * LAYER 3 FILTERS: beforeConsent=true, NOT benign resource type (image/font/stylesheet/media/texttrack/manifest),
 *   NOT benign extension (.webp/.svg/.png/... 21 extensions), Category A URL required (or isTracking fallback).
 *   Exceptions: .gif with search.length>10 passes; image with tracking pixel path + search.length>10 passes.
 * SOURCE: backend/src/analyzers/confirmed-tracking-filter.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMetricHierarchy,
  computeConfirmedTrackingViolations,
  BENIGN_RESOURCE_TYPES,
  BENIGN_EXTENSIONS,
  TRACKING_PIXEL_PATHS
} = require('../src/analyzers/confirmed-tracking-filter');

const {
  sampleNetworkRequests,
  sampleRequestCategorization
} = require('./fixtures/sample-scan-results');

describe('confirmed-tracking-filter: buildMetricHierarchy', () => {

  const hierarchy = buildMetricHierarchy(sampleNetworkRequests, sampleRequestCategorization);

  // ─── Test 1: Layer 1 = total raw requests ──────────────────────────
  it('Layer 1 count equals total network requests', () => {
    assert.equal(hierarchy.layer1.count, sampleNetworkRequests.length);
    assert.equal(hierarchy.layer1.count, 7);
  });

  // ─── Test 2: Layer 2 = Category A + B ──────────────────────────────
  it('Layer 2 count equals Category A + B combined', () => {
    const expected = sampleRequestCategorization.categoryA.count +
                     sampleRequestCategorization.categoryB.count;
    assert.equal(hierarchy.layer2.count, expected);
    assert.equal(hierarchy.layer2.count, 3); // 2 Cat A + 1 Cat B
  });

  // ─── Test 3: Layer 3 ≤ Layer 2 ────────────────────────────────────
  it('Layer 3 count is less than or equal to Layer 2 count', () => {
    assert.ok(hierarchy.layer3.count <= hierarchy.layer2.count,
      `Layer 3 (${hierarchy.layer3.count}) > Layer 2 (${hierarchy.layer2.count})`);
  });

  // ─── Test 4: Layer 3 excludes after-consent requests ───────────────
  it('Layer 3 excludes requests with beforeConsent=false', () => {
    // sampleNetworkRequests[5] is GA4 with beforeConsent=false, it IS Category A URL
    // but should NOT be in Layer 3 because beforeConsent=false
    const afterConsentGA = sampleNetworkRequests[5]; // after-consent GA4
    const l3Urls = hierarchy.layer3.requests.map(r => r.url);
    assert.ok(!l3Urls.includes(afterConsentGA.url),
      'After-consent request should not be in Layer 3');
  });

  // ─── Test 5: Layer 3 excludes benign resource types ────────────────
  it('Layer 3 excludes benign resource types (stylesheet)', () => {
    // Create a request that passes all L3 filters except resource type
    const cssReq = {
      url: sampleRequestCategorization.categoryA.requests[0].url,
      resourceType: 'stylesheet',
      beforeConsent: true,
      isTracking: true
    };
    const requests = [cssReq];
    const violations = computeConfirmedTrackingViolations(requests, sampleRequestCategorization);
    assert.equal(violations.length, 0, 'Stylesheet should be excluded from Layer 3');
  });

  // ─── Test 6: Layer 3 excludes benign extensions ────────────────────
  it('Layer 3 excludes .woff2 extension even with beforeConsent=true', () => {
    const fontReq = {
      url: 'https://fonts.example.com/font.woff2',
      resourceType: 'xhr', // Not a benign type — testing extension filter
      beforeConsent: true,
      isTracking: true
    };
    const catWithFont = {
      ...sampleRequestCategorization,
      categoryA: {
        count: 1,
        requests: [{ url: 'https://fonts.example.com/font.woff2', confidence: 80 }]
      }
    };
    const violations = computeConfirmedTrackingViolations([fontReq], catWithFont);
    assert.equal(violations.length, 0, '.woff2 should be excluded from Layer 3');
  });

  // ─── Test 7: Layer 3 includes tracking pixels (.gif exception) ─────
  it('Layer 3 includes .gif tracking pixel with search.length > 10', () => {
    const pixelUrl = 'https://www.google-analytics.com/collect/t.gif?v=1&tid=UA-XXX&cid=123.456&t=pageview';
    const pixelReq = {
      url: pixelUrl,
      resourceType: 'image',
      beforeConsent: true,
      isTracking: true
    };
    const catWithPixel = {
      categoryA: { count: 1, requests: [{ url: pixelUrl, confidence: 85 }] },
      categoryB: { count: 0, requests: [] },
      categoryC: { count: 0, requests: [] }
    };
    const violations = computeConfirmedTrackingViolations([pixelReq], catWithPixel);
    assert.equal(violations.length, 1, '.gif tracking pixel with payload should be in Layer 3');
  });

  // ─── Test 8: Layer 3 includes ONLY Category A ─────────────────────
  it('Layer 3 excludes Category B requests', () => {
    // Category B request with beforeConsent=true, no benign type/ext
    const catBReq = {
      url: 'https://cdn.example.com/analytics.js?v=1',
      resourceType: 'script',
      beforeConsent: true,
      isTracking: false
    };
    // This URL is in categoryB, NOT categoryA
    const violations = computeConfirmedTrackingViolations([catBReq], sampleRequestCategorization);
    assert.equal(violations.length, 0, 'Category B request should not be in Layer 3');
  });

  // ─── Test 9: Empty/null input handling ─────────────────────────────
  it('handles empty/null input without throwing', () => {
    const empty = buildMetricHierarchy([], null);
    assert.equal(empty.layer1.count, 0);
    assert.equal(empty.layer2.count, 0);
    assert.equal(empty.layer3.count, 0);

    const nullResult = buildMetricHierarchy(null, null);
    assert.equal(nullResult.layer1.count, 0);

    const undefinedResult = buildMetricHierarchy(undefined, undefined);
    assert.equal(undefinedResult.layer1.count, 0);
  });

  // ─── Test 10: Legacy fallback (isTracking) ─────────────────────────
  it('falls back to req.isTracking when requestCategorization is null', () => {
    const reqs = [
      { url: 'https://tracker.example.com/pixel', beforeConsent: true, isTracking: true, resourceType: 'xhr' },
      { url: 'https://example.com/api', beforeConsent: true, isTracking: false, resourceType: 'xhr' }
    ];
    const violations = computeConfirmedTrackingViolations(reqs, null);
    assert.equal(violations.length, 1, 'Should use isTracking fallback');
    assert.equal(violations[0].url, 'https://tracker.example.com/pixel');
  });

  // ─── Test 11: Output structure validation ──────────────────────────
  it('output contains all expected properties', () => {
    assert.ok('layer1' in hierarchy);
    assert.ok('layer2' in hierarchy);
    assert.ok('layer3' in hierarchy);
    assert.ok('internalControl' in hierarchy);
    assert.ok('funnelExplanation' in hierarchy);

    assert.ok('count' in hierarchy.layer1);
    assert.ok('label' in hierarchy.layer1);
    assert.ok('legalStatus' in hierarchy.layer1);

    assert.ok('isAuthoritative' in hierarchy.layer3);
    assert.equal(hierarchy.layer3.isAuthoritative, true);
    assert.ok(Array.isArray(hierarchy.layer3.requests));

    assert.ok('exposureRate' in hierarchy.internalControl);
    assert.ok('exposureRatePct' in hierarchy.internalControl);
    assert.ok('detectionPrecision' in hierarchy.internalControl);
    assert.ok('detectionPrecisionPct' in hierarchy.internalControl);
  });

  // ─── Test 12: funnelExplanation is non-empty string ────────────────
  it('funnelExplanation is a non-empty string', () => {
    assert.ok(typeof hierarchy.funnelExplanation === 'string');
    assert.ok(hierarchy.funnelExplanation.length > 50);
    // Should contain the actual counts
    assert.ok(hierarchy.funnelExplanation.includes(String(hierarchy.layer1.count)));
    assert.ok(hierarchy.funnelExplanation.includes(String(hierarchy.layer3.count)));
  });

  // ─── Test 13: BENIGN_RESOURCE_TYPES exported correctly ─────────────
  it('BENIGN_RESOURCE_TYPES contains expected types', () => {
    assert.ok(BENIGN_RESOURCE_TYPES.includes('font'));
    assert.ok(BENIGN_RESOURCE_TYPES.includes('stylesheet'));
    assert.ok(BENIGN_RESOURCE_TYPES.includes('image'));
    assert.ok(BENIGN_RESOURCE_TYPES.includes('media'));
  });

  // ─── Test 14: BENIGN_EXTENSIONS exported correctly ─────────────────
  it('BENIGN_EXTENSIONS contains expected extensions', () => {
    assert.ok(BENIGN_EXTENSIONS.includes('.woff2'));
    assert.ok(BENIGN_EXTENSIONS.includes('.css'));
    assert.ok(BENIGN_EXTENSIONS.includes('.png'));
    assert.ok(BENIGN_EXTENSIONS.includes('.gif'));
  });
});
