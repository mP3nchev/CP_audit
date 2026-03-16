/*
 * FUNCTION UNDER TEST: analyzeRequest
 * SIGNATURE: analyzeRequest(request, allRequests = [])
 * INPUT SHAPE: request = { url, pathname, urlObj (URL), vendor, isResource, method,
 *   resourceType, responseStatus, failed, postData, firedBeforeConsent,
 *   timestamp, pageLoadTimestamp }
 * OUTPUT SHAPE: { scores: { l4_semantic, l2_entropy, l1_protocol, l3_behavioral,
 *   l5_fingerprint }, composite (0-100), category ('A'|'B'|'C'), isConsentPing (bool),
 *   reason? (string, only when isConsentPing=true) }
 * EDGE CASES: urlObj=null → L2/L5 return 0; consent pings → composite=10, category='C';
 *   responseStatus=0 → L1 -50; failed=true → L1 -50; vendor+isResource → L4 demoted
 * SOURCE: backend/src/analyzers/detection-confidence.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeRequest,
  scoreToCategory,
  calculateCompositeScore,
  LAYER_WEIGHTS
} = require('../src/analyzers/detection-confidence');

const {
  knownTrackingRequests,
  knownBenignRequests,
  knownConsentPings,
  knownBlockedRequests,
  buildRequest
} = require('./fixtures/sample-requests');

describe('detection-confidence: analyzeRequest', () => {

  // ─── Test 1: Known tracking requests score high (Category A or B) ───
  // The 5-layer engine scores individual requests. Real Category A (≥70) requires
  // maximum signal alignment. With vendor + endpoint + identity params + pre-consent,
  // these fixtures reach Category B (40-69) or A depending on signal density.
  describe('known tracking requests → high confidence (Category A or B)', () => {
    for (const req of knownTrackingRequests) {
      it(`classifies ${new URL(req.url).hostname} as tracking (confidence ≥40)`, () => {
        const result = analyzeRequest(req, knownTrackingRequests);
        assert.ok(result.composite >= 40,
          `Expected composite ≥40, got ${result.composite} for ${req.url}`);
        assert.ok(['A', 'B'].includes(result.category),
          `Expected Category A or B, got ${result.category}`);
        assert.equal(result.isConsentPing, false);
      });
    }
  });

  // ─── Test 1b: Maximally enriched request reaches Category A (≥70) ──
  it('maximally enriched tracking request reaches Category A', () => {
    // Stack ALL layers: vendor + high-conf endpoint + identity params +
    // POST beacon + pre-consent + early timing + fingerprint params + same-host cluster
    const maxReq = buildRequest({
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXX&cid=123456.7890&uid=user_abc&_fid=fid123abc&sr=1920x1080&sd=24&ul=en-us&vp=1920x1080',
      vendor: 'Google Analytics 4',
      resourceType: 'ping',
      method: 'POST',
      firedBeforeConsent: true,
      timestamp: 0.1,
      pageLoadTimestamp: 0,
      postData: '{"client_id":"123456.7890","events":[{"name":"page_view"}]}'
    });
    // Provide multiple same-host requests for L3 frequency clustering
    const allReqs = Array(12).fill(null).map((_, i) => buildRequest({
      url: `https://www.google-analytics.com/g/collect?v=2&seq=${i}`,
      vendor: 'Google Analytics 4'
    }));
    const result = analyzeRequest(maxReq, allReqs);
    assert.ok(result.composite >= 70,
      `Expected composite ≥70 for max enrichment, got ${result.composite}`);
    assert.equal(result.category, 'A');
  });

  // ─── Test 2: Known benign requests score <40 (Category C) ──────────
  describe('known benign requests → Category C', () => {
    for (const req of knownBenignRequests) {
      it(`classifies ${new URL(req.url).hostname}${new URL(req.url).pathname} as Category C`, () => {
        const result = analyzeRequest(req, []);
        assert.ok(result.composite < 40,
          `Expected composite <40, got ${result.composite} for ${req.url}`);
        assert.equal(result.category, 'C');
      });
    }
  });

  // ─── Test 3: Consent pings are excluded ────────────────────────────
  describe('consent pings → isConsentPing=true, Category C', () => {
    for (const req of knownConsentPings) {
      it(`identifies consent ping: ${req.url.substring(0, 80)}...`, () => {
        const result = analyzeRequest(req, []);
        assert.equal(result.isConsentPing, true);
        assert.equal(result.category, 'C');
        assert.equal(result.composite, 10);
        assert.ok(typeof result.reason === 'string');
      });
    }
  });

  // ─── Test 4: Blocked requests get low scores ──────────────────────
  describe('blocked requests (status 0, failed) → low confidence', () => {
    for (const req of knownBlockedRequests) {
      it(`demotes blocked request: ${new URL(req.url).hostname}`, () => {
        const result = analyzeRequest(req, []);
        // L1 applies -50 for status 0 AND -50 for failed=true
        // This heavily penalizes the composite score
        assert.ok(result.scores.l1_protocol === 0,
          `Expected l1_protocol=0 (clamped), got ${result.scores.l1_protocol}`);
      });
    }
  });

  // ─── Test 5: All 5 layer scores present ────────────────────────────
  it('returns all 5 layer scores in result.scores', () => {
    const result = analyzeRequest(knownTrackingRequests[0], []);
    assert.ok('l4_semantic' in result.scores);
    assert.ok('l2_entropy' in result.scores);
    assert.ok('l1_protocol' in result.scores);
    assert.ok('l3_behavioral' in result.scores);
    assert.ok('l5_fingerprint' in result.scores);
    assert.ok(typeof result.composite === 'number');
    assert.ok(['A', 'B', 'C'].includes(result.category));
    assert.ok(typeof result.isConsentPing === 'boolean');
  });

  // ─── Test 6: Deterministic ─────────────────────────────────────────
  it('produces identical results for identical input', () => {
    const req = knownTrackingRequests[0];
    const result1 = analyzeRequest(req, knownTrackingRequests);
    const result2 = analyzeRequest(req, knownTrackingRequests);
    assert.equal(JSON.stringify(result1), JSON.stringify(result2));
  });

  // ─── Test 7: Edge case — request with no URL params ────────────────
  it('handles request with empty query string', () => {
    const req = buildRequest({
      url: 'https://example.com/page',
      vendor: null,
      resourceType: 'document'
    });
    const result = analyzeRequest(req, []);
    assert.ok(typeof result.composite === 'number');
    assert.ok(result.composite >= 0 && result.composite <= 100);
  });

  // ─── Test 8: Edge case — unknown domain ────────────────────────────
  it('handles unknown domain with low confidence', () => {
    const req = buildRequest({
      url: 'https://unknown-domain-xyz.test/api/data?user=123',
      vendor: null,
      resourceType: 'xhr'
    });
    const result = analyzeRequest(req, []);
    assert.ok(typeof result.composite === 'number');
    // No vendor, no high-confidence endpoint → should be relatively low
    assert.ok(result.composite < 70,
      `Expected <70 for unknown domain, got ${result.composite}`);
  });

  // ─── Test 9: scoreToCategory boundaries ────────────────────────────
  it('scoreToCategory returns correct categories at boundaries', () => {
    assert.equal(scoreToCategory(70), 'A');
    assert.equal(scoreToCategory(69), 'B');
    assert.equal(scoreToCategory(40), 'B');
    assert.equal(scoreToCategory(39), 'C');
    assert.equal(scoreToCategory(0), 'C');
    assert.equal(scoreToCategory(100), 'A');
  });

  // ─── Test 10: Layer weights sum to 1.0 ─────────────────────────────
  it('layer weights sum to 1.0', () => {
    const sum = Object.values(LAYER_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights sum to ${sum}, expected 1.0`);
  });

  // ─── Test 11: Composite score respects layer weights ───────────────
  it('calculateCompositeScore applies weights correctly', () => {
    const scores = {
      l4_semantic: 100,
      l2_entropy: 100,
      l1_protocol: 100,
      l3_behavioral: 100,
      l5_fingerprint: 100
    };
    const composite = calculateCompositeScore(scores);
    assert.equal(composite, 100);

    const zeroScores = {
      l4_semantic: 0,
      l2_entropy: 0,
      l1_protocol: 0,
      l3_behavioral: 0,
      l5_fingerprint: 0
    };
    assert.equal(calculateCompositeScore(zeroScores), 0);
  });

  // ─── Test 12: Vendor + isResource demotes L4 ──────────────────────
  it('known vendor with isResource=true gets demoted L4 score', () => {
    const scriptLoad = buildRequest({
      url: 'https://www.google-analytics.com/analytics.js',
      vendor: 'Google Analytics',
      resourceType: 'script',
      isResource: true
    });
    const result = analyzeRequest(scriptLoad, []);
    // vendor=true, isResource=true → L4 returns max(0, 20-40) = 0
    assert.equal(result.scores.l4_semantic, 0);
  });
});
