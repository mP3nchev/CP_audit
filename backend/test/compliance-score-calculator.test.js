/*
 * FUNCTION UNDER TEST: calculateOverallScore
 * SIGNATURE: calculateOverallScore(auditResults)
 * DB ACCESS: NONE — pure function on data objects
 * INPUT SHAPE: auditResults = {
 *   policyAnalysis: { total_score, max_score, percentage } | null,
 *   bannerAnalysis: { bannerDetected, bannerDetectionStatus, totalChecks, passedCount,
 *     violations, hasCriticalViolations, violationCount, skippedCount } | null,
 *   consentSimulation: { success, comparison: { clickImbalance, violations } } | null,
 *   scanResults: { tracking_before_consent, cookies } | null,
 *   consentModeAnalysis: { detected, compliant, implementationScore } | null,
 *   cookieComparison: { accuracyScore, matched, totalDetected } | null
 * }
 * OUTPUT SHAPE: { overallScore (0-100), grade ('A'|'B'|'C'|'D'|'F'),
 *   components: { privacyPolicy, cookieBanner, technical, cookiePolicy },
 *   capsApplied: string[], weights: { privacyPolicy, cookieBanner, technical, cookiePolicy } }
 * WEIGHTS: default: 0.35/0.30/0.20/0.15
 *   no privacy policy: 0/0.45/0.35/0.20
 *   no cookie policy (with privacy): 0.40/0.40/0.20/0
 *   both missing: 0/0.55/0.45/0
 * GRADES: A≥90, B≥75, C≥60, D≥40, F<40
 * CAPS: tracking_before_consent → max 55, no consent mechanism → max 50, both → max 40
 * BANNER_NOT_DETECTED: score=0; mobile-only: 50% penalty
 * SOURCE: backend/src/analyzers/compliance-score-calculator.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateOverallScore,
  determineGrade,
  getGradeInfo
} = require('../src/analyzers/compliance-score-calculator');

const {
  sampleAuditResultsFull,
  sampleAuditResultsNoPolicy,
  sampleAuditResultsWorst,
  sampleAuditResultsNoBanner,
  sampleAuditResultsMobileOnlyBanner
} = require('./fixtures/sample-scan-results');

describe('compliance-score-calculator: calculateOverallScore', () => {

  // ─── Test 1: Full data produces score 0-100 ───────────────────────
  it('produces a score between 0 and 100 with full data', () => {
    const result = calculateOverallScore(sampleAuditResultsFull);
    assert.ok(result.overallScore >= 0 && result.overallScore <= 100,
      `Score ${result.overallScore} out of range`);
    assert.ok(typeof result.grade === 'string');
    assert.ok(['A', 'B', 'C', 'D', 'F'].includes(result.grade));
  });

  // ─── Test 2: Grade assignment at exact boundaries ─────────────────
  describe('grade boundaries', () => {
    it('score 90 → grade A', () => assert.equal(determineGrade(90), 'A'));
    it('score 89 → grade B', () => assert.equal(determineGrade(89), 'B'));
    it('score 75 → grade B', () => assert.equal(determineGrade(75), 'B'));
    it('score 74 → grade C', () => assert.equal(determineGrade(74), 'C'));
    it('score 60 → grade C', () => assert.equal(determineGrade(60), 'C'));
    it('score 59 → grade D', () => assert.equal(determineGrade(59), 'D'));
    it('score 40 → grade D', () => assert.equal(determineGrade(40), 'D'));
    it('score 39 → grade F', () => assert.equal(determineGrade(39), 'F'));
    it('score 0 → grade F', () => assert.equal(determineGrade(0), 'F'));
    it('score 100 → grade A', () => assert.equal(determineGrade(100), 'A'));
  });

  // ─── Test 3: Default weights are correct ──────────────────────────
  it('uses correct default weights when all components present', () => {
    const result = calculateOverallScore(sampleAuditResultsFull);
    assert.equal(result.weights.privacyPolicy, 0.35);
    assert.equal(result.weights.cookieBanner, 0.30);
    assert.equal(result.weights.technical, 0.20);
    assert.equal(result.weights.cookiePolicy, 0.15);
  });

  // ─── Test 4: Weight redistribution — no privacy policy ────────────
  it('redistributes weights when privacy policy is missing', () => {
    const result = calculateOverallScore(sampleAuditResultsNoPolicy);
    assert.equal(result.weights.privacyPolicy, 0);
    assert.equal(result.weights.cookieBanner, 0.45);
    assert.equal(result.weights.technical, 0.35);
    assert.equal(result.weights.cookiePolicy, 0.20);
    assert.equal(result.components.privacyPolicy, null);
    assert.ok(result.overallScore >= 0);
  });

  // ─── Test 5: Weight redistribution — no cookie policy ─────────────
  it('redistributes weights when cookie policy is missing', () => {
    const input = {
      ...sampleAuditResultsFull,
      cookieComparison: null
    };
    const result = calculateOverallScore(input);
    assert.equal(result.weights.privacyPolicy, 0.40);
    assert.equal(result.weights.cookieBanner, 0.40);
    assert.equal(result.weights.technical, 0.20);
    assert.equal(result.weights.cookiePolicy, 0);
    assert.equal(result.components.cookiePolicy, null);
  });

  // ─── Test 5b: Weight redistribution — both missing ────────────────
  it('redistributes weights when both policies missing', () => {
    const input = {
      ...sampleAuditResultsNoPolicy,
      cookieComparison: null
    };
    const result = calculateOverallScore(input);
    assert.equal(result.weights.privacyPolicy, 0);
    assert.equal(result.weights.cookieBanner, 0.55);
    assert.equal(result.weights.technical, 0.45);
    assert.equal(result.weights.cookiePolicy, 0);
  });

  // ─── Test 6: Zero violations → high score ─────────────────────────
  it('good compliance produces a high score', () => {
    const result = calculateOverallScore(sampleAuditResultsFull);
    assert.ok(result.overallScore >= 60,
      `Expected ≥60 for good compliance, got ${result.overallScore}`);
  });

  // ─── Test 7: Maximum violations → low score ──────────────────────
  it('maximum violations produce a low score (capped at 40)', () => {
    const result = calculateOverallScore(sampleAuditResultsWorst);
    // tracking_before_consent=true AND no cookies → both caps apply → max 40
    assert.ok(result.overallScore <= 40,
      `Expected ≤40 for worst case, got ${result.overallScore}`);
  });

  // ─── Test 8: Deterministic ────────────────────────────────────────
  it('produces identical results for identical input', () => {
    const result1 = calculateOverallScore(sampleAuditResultsFull);
    const result2 = calculateOverallScore(sampleAuditResultsFull);
    assert.equal(result1.overallScore, result2.overallScore);
    assert.equal(result1.grade, result2.grade);
    assert.deepStrictEqual(result1.weights, result2.weights);
  });

  // ─── Test 9: BANNER_NOT_DETECTED → banner score 0 ────────────────
  it('bannerDetected=false produces banner component score of 0', () => {
    const result = calculateOverallScore(sampleAuditResultsNoBanner);
    assert.equal(result.components.cookieBanner.score, 0);
    assert.ok(result.components.cookieBanner.details.includes('No cookie consent banner'));
  });

  // ─── Test 10: Mobile-only banner → 50% penalty ───────────────────
  it('mobile-only banner applies 50% penalty to banner score', () => {
    const desktopResult = calculateOverallScore(sampleAuditResultsFull);
    const mobileResult = calculateOverallScore(sampleAuditResultsMobileOnlyBanner);
    // Both have similar passedCount/totalChecks, but mobile gets 50% penalty
    assert.ok(mobileResult.components.cookieBanner.score < desktopResult.components.cookieBanner.score,
      `Mobile score ${mobileResult.components.cookieBanner.score} should be less than desktop ${desktopResult.components.cookieBanner.score}`);
  });

  // ─── Test 11: Cap — tracking before consent → max 55 ─────────────
  it('tracking before consent caps score at 55', () => {
    const input = {
      ...sampleAuditResultsFull,
      scanResults: { tracking_before_consent: true, cookies: [{ name: '_ga' }] }
    };
    const result = calculateOverallScore(input);
    assert.ok(result.overallScore <= 55,
      `Expected ≤55 with tracking cap, got ${result.overallScore}`);
    assert.ok(result.capsApplied.some(c => c.includes('55')));
  });

  // ─── Test 12: Output structure ────────────────────────────────────
  it('output has all expected properties', () => {
    const result = calculateOverallScore(sampleAuditResultsFull);
    assert.ok('overallScore' in result);
    assert.ok('grade' in result);
    assert.ok('components' in result);
    assert.ok('capsApplied' in result);
    assert.ok('weights' in result);

    assert.ok('privacyPolicy' in result.components);
    assert.ok('cookieBanner' in result.components);
    assert.ok('technical' in result.components);
    assert.ok('cookiePolicy' in result.components);

    // Each non-null component has score, contribution, details
    assert.ok('score' in result.components.cookieBanner);
    assert.ok('contribution' in result.components.cookieBanner);
    assert.ok('details' in result.components.cookieBanner);
  });

  // ─── Test 13: getGradeInfo returns expected structure ─────────────
  it('getGradeInfo returns name, description, color, range', () => {
    for (const grade of ['A', 'B', 'C', 'D', 'F']) {
      const info = getGradeInfo(grade);
      assert.ok('name' in info);
      assert.ok('description' in info);
      assert.ok('color' in info);
      assert.ok('range' in info);
    }
  });

  // ─── Test 14: Weighted sum is correct ─────────────────────────────
  it('weighted component sum matches overall score (before caps)', () => {
    // Use an input where no caps apply
    const result = calculateOverallScore(sampleAuditResultsFull);
    const components = result.components;

    // Manual weighted sum
    const expected =
      (components.privacyPolicy?.score || 0) * result.weights.privacyPolicy +
      (components.cookieBanner?.score || 0) * result.weights.cookieBanner +
      (components.technical?.score || 0) * result.weights.technical +
      (components.cookiePolicy?.score || 0) * result.weights.cookiePolicy;

    // If no caps applied, overallScore should equal the rounded weighted sum
    if (result.capsApplied.length === 0) {
      assert.ok(Math.abs(result.overallScore - Math.round(expected)) <= 1,
        `Expected ~${Math.round(expected)}, got ${result.overallScore}`);
    }
  });
});
