/**
 * Overall Compliance Score Calculator (1-100)
 * Based on weighted components from all audit phases
 */

/**
 * Calculate overall compliance score
 * @param {Object} auditResults - Results from all phases
 * @returns {Object} Overall score and breakdown
 */
function calculateOverallScore(auditResults) {
  console.log('📊 Calculating overall compliance score...');

  // Component weights (must total 100%)
  const weights = {
    privacyPolicy: 0.35,      // 35%
    cookieBanner: 0.30,       // 30%
    technical: 0.20,          // 20%
    cookiePolicy: 0.15        // 15%
  };

  // Calculate each component
  const components = {
    privacyPolicy: calculatePrivacyPolicyScore(auditResults),
    cookieBanner: calculateCookieBannerScore(auditResults),
    technical: calculateTechnicalScore(auditResults),
    cookiePolicy: calculateCookiePolicyScore(auditResults)
  };

  // Calculate weighted contributions
  const contributions = {
    privacyPolicy: components.privacyPolicy.score * weights.privacyPolicy,
    cookieBanner: components.cookieBanner.score * weights.cookieBanner,
    technical: components.technical.score * weights.technical,
    cookiePolicy: components.cookiePolicy.score * weights.cookiePolicy
  };

  // Sum contributions
  let overallScore = Math.round(
    contributions.privacyPolicy +
    contributions.cookieBanner +
    contributions.technical +
    contributions.cookiePolicy
  );

  // Apply critical violation caps
  const { cappedScore, capsApplied } = applyCriticalViolationCaps(overallScore, auditResults);
  overallScore = cappedScore;

  // Determine grade
  const grade = determineGrade(overallScore);

  console.log(`  ✅ Overall Compliance Score: ${overallScore}/100 (Grade: ${grade})`);
  console.log(`     - Privacy Policy: ${components.privacyPolicy.score}/100 (contributes ${contributions.privacyPolicy.toFixed(1)} points)`);
  console.log(`     - Cookie Banner: ${components.cookieBanner.score}/100 (contributes ${contributions.cookieBanner.toFixed(1)} points)`);
  console.log(`     - Technical: ${components.technical.score}/100 (contributes ${contributions.technical.toFixed(1)} points)`);
  console.log(`     - Cookie Policy: ${components.cookiePolicy.score}/100 (contributes ${contributions.cookiePolicy.toFixed(1)} points)`);

  if (capsApplied.length > 0) {
    console.log(`     ⚠️  Critical caps applied: ${capsApplied.join(', ')}`);
  }

  return {
    overallScore,
    grade,
    components: {
      privacyPolicy: {
        score: components.privacyPolicy.score,
        contribution: contributions.privacyPolicy,
        details: components.privacyPolicy.details
      },
      cookieBanner: {
        score: components.cookieBanner.score,
        contribution: contributions.cookieBanner,
        details: components.cookieBanner.details
      },
      technical: {
        score: components.technical.score,
        contribution: contributions.technical,
        details: components.technical.details
      },
      cookiePolicy: {
        score: components.cookiePolicy.score,
        contribution: contributions.cookiePolicy,
        details: components.cookiePolicy.details
      }
    },
    capsApplied,
    weights
  };
}

/**
 * Calculate Privacy Policy component score (35% weight)
 * @param {Object} results - Audit results
 * @returns {Object} Score and details
 */
function calculatePrivacyPolicyScore(results) {
  const analysis = results.policyAnalysis;

  if (!analysis || !analysis.total_score || !analysis.max_score) {
    return {
      score: 0,
      details: 'Privacy Policy analysis not available'
    };
  }

  // Score = (actual_score / max_score) * 100
  const score = Math.round((analysis.total_score / analysis.max_score) * 100);

  return {
    score,
    details: `${analysis.total_score}/${analysis.max_score} criteria points (${analysis.percentage.toFixed(1)}%)`
  };
}

/**
 * Calculate Cookie Banner component score (30% weight)
 * @param {Object} results - Audit results
 * @returns {Object} Score and details
 */
function calculateCookieBannerScore(results) {
  const bannerAnalysis = results.bannerAnalysis;
  const consentSim = results.consentSimulation;

  if (!bannerAnalysis) {
    return {
      score: 0,
      details: 'Cookie banner analysis not available'
    };
  }

  const totalChecks = bannerAnalysis.totalChecks || 8;
  let passedChecks = bannerAnalysis.passedCount || 0;

  // Critical violations count double
  const criticalViolations = bannerAnalysis.violations?.filter(v => v.severity === 'critical') || [];
  const criticalPenalty = criticalViolations.length;

  // Adjust passed checks (each critical violation counts as -2)
  passedChecks = Math.max(0, passedChecks - criticalPenalty);

  let baseScore = Math.round((passedChecks / totalChecks) * 100);

  // Apply Accept/Reject symmetry penalty from consent simulation (Problem 3)
  if (consentSim && consentSim.comparison && consentSim.success !== false) {
    const clickImbalance = consentSim.comparison.clickImbalance || 0;
    const symmetryViolations = consentSim.comparison.violations?.length || 0;

    // Deduct up to 15 points for click imbalance (1 point per extra click, max 10)
    const clickPenalty = Math.min(clickImbalance, 10);

    // Deduct up to 5 points for symmetry violations
    const symmetryPenalty = Math.min(symmetryViolations * 2, 5);

    baseScore = Math.max(0, baseScore - clickPenalty - symmetryPenalty);
  }

  const score = baseScore;

  return {
    score,
    details: `${bannerAnalysis.passedCount}/${totalChecks} noyb checks passed${criticalViolations.length > 0 ? ` (${criticalViolations.length} critical)` : ''}${consentSim && consentSim.comparison ? `, ${consentSim.comparison.clickImbalance} click imbalance` : ''}`
  };
}

/**
 * Calculate Technical Implementation score (20% weight)
 * @param {Object} results - Audit results
 * @returns {Object} Score and details
 */
function calculateTechnicalScore(results) {
  const scanResults = results.scanResults;
  const consentMode = results.consentModeAnalysis;

  if (!scanResults) {
    return {
      score: 0,
      details: 'Technical scan not available'
    };
  }

  let scores = [];

  // 1. Tracking before consent (50% of technical score)
  const trackingScore = scanResults.tracking_before_consent ? 0 : 100;
  scores.push({
    name: 'Tracking before consent',
    score: trackingScore,
    weight: 0.5
  });

  // 2. Consent Mode V2 (50% of technical score)
  let consentModeScore = 0;
  if (consentMode) {
    if (!consentMode.detected) {
      consentModeScore = 50; // Partial credit if not using Google services
    } else if (consentMode.compliant) {
      consentModeScore = 100;
    } else {
      consentModeScore = consentMode.implementationScore || 50;
    }
  } else {
    consentModeScore = 50; // No data, give neutral score
  }

  scores.push({
    name: 'Consent Mode V2',
    score: consentModeScore,
    weight: 0.5
  });

  // Calculate weighted average
  const totalScore = scores.reduce((sum, s) => sum + (s.score * s.weight), 0);
  const score = Math.round(totalScore);

  return {
    score,
    details: `Tracking: ${trackingScore}/100, Consent Mode: ${consentModeScore}/100`
  };
}

/**
 * Calculate Cookie Policy component score (15% weight)
 * @param {Object} results - Audit results
 * @returns {Object} Score and details
 */
function calculateCookiePolicyScore(results) {
  const comparison = results.cookieComparison;

  if (!comparison) {
    return {
      score: 50,  // Neutral score if no comparison available
      details: 'Cookie Policy comparison not available'
    };
  }

  // Score = (correctly declared / total detected) * 100
  const score = comparison.accuracyScore || 0;

  return {
    score,
    details: `${comparison.matched?.length || 0}/${comparison.totalDetected || 0} cookies correctly declared`
  };
}

/**
 * Apply critical violation caps
 * @param {number} score - Current score
 * @param {Object} results - Audit results
 * @returns {Object} Capped score and caps applied
 */
function applyCriticalViolationCaps(score, results) {
  const capsApplied = [];
  let cappedScore = score;

  // Cap 1: Tracking before consent → max 55
  if (results.scanResults?.tracking_before_consent) {
    if (cappedScore > 55) {
      cappedScore = 55;
      capsApplied.push('Tracking before consent (cap at 55)');
    }
  }

  // Cap 2: No consent mechanism at all → max 50
  const hasConsentMechanism = results.scanResults?.cookies?.length > 0 ||
                             results.bannerAnalysis?.passedCount > 0;

  if (!hasConsentMechanism) {
    if (cappedScore > 50) {
      cappedScore = 50;
      capsApplied.push('No consent mechanism (cap at 50)');
    }
  }

  // Cap 3: Both violations → max 40
  if (results.scanResults?.tracking_before_consent && !hasConsentMechanism) {
    if (cappedScore > 40) {
      cappedScore = 40;
      capsApplied.push('Multiple critical violations (cap at 40)');
    }
  }

  return {
    cappedScore,
    capsApplied
  };
}

/**
 * Determine letter grade from score
 * @param {number} score - Overall score (0-100)
 * @returns {string} Grade letter
 */
function determineGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Get grade description
 * @param {string} grade - Grade letter
 * @returns {Object} Grade info
 */
function getGradeInfo(grade) {
  const gradeMap = {
    'A': {
      name: 'Excellent',
      description: 'Full GDPR compliance',
      color: '#10b981',
      range: '90-100'
    },
    'B': {
      name: 'Good',
      description: 'Minor compliance issues',
      color: '#22c55e',
      range: '75-89'
    },
    'C': {
      name: 'Fair',
      description: 'Moderate compliance issues',
      color: '#eab308',
      range: '60-74'
    },
    'D': {
      name: 'Poor',
      description: 'Significant GDPR violations',
      color: '#f59e0b',
      range: '40-59'
    },
    'F': {
      name: 'Critical',
      description: 'Severe GDPR violations',
      color: '#dc2626',
      range: '0-39'
    }
  };

  return gradeMap[grade] || gradeMap['F'];
}

/**
 * Generate score summary for reporting
 * @param {Object} scoreResult - Result from calculateOverallScore()
 * @returns {string} Summary text
 */
function generateScoreSummary(scoreResult) {
  const gradeInfo = getGradeInfo(scoreResult.grade);

  let summary = `Your website received an overall compliance score of ${scoreResult.overallScore}/100 (Grade ${scoreResult.grade}: ${gradeInfo.name}).\n\n`;

  summary += 'Component Breakdown:\n';
  summary += `- Privacy Policy: ${scoreResult.components.privacyPolicy.score}/100\n`;
  summary += `- Cookie Banner: ${scoreResult.components.cookieBanner.score}/100\n`;
  summary += `- Technical Implementation: ${scoreResult.components.technical.score}/100\n`;
  summary += `- Cookie Policy Accuracy: ${scoreResult.components.cookiePolicy.score}/100\n`;

  if (scoreResult.capsApplied.length > 0) {
    summary += `\n⚠️ Critical Violations: ${scoreResult.capsApplied.join(', ')}\n`;
  }

  return summary;
}

module.exports = {
  calculateOverallScore,
  determineGrade,
  getGradeInfo,
  generateScoreSummary
};
