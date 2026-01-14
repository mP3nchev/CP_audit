const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { getDatabase } = require('../database/db');
const { getPolicyAnalysis } = require('../analyzers/privacy-policy-analyzer');

/**
 * Generate HTML report using user's gdpr-report-template.html
 * @param {string} auditUid - Audit UID
 * @returns {Promise<string>} Complete HTML report
 */
async function generateReport(auditUid) {
  try {
    console.log(`📊 Generating HTML report for audit ${auditUid}...`);

    // Load user's template
    const templatePath = path.join(__dirname, '../../templates/gdpr-report-template.html');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(templateSource);

    // Gather all audit data
    const data = await gatherAuditData(auditUid);

    // Transform data to match template structure
    const templateData = transformDataForTemplate(data);

    // Render template with data
    const html = template(templateData);

    console.log(`✅ Report generated successfully (${(html.length / 1024).toFixed(2)} KB)`);

    return html;
  } catch (error) {
    console.error('❌ Report generation failed:', error.message);
    throw error;
  }
}

/**
 * Gather all audit data from database
 * @param {string} auditUid - Audit UID
 * @returns {Promise<Object>} Complete audit data
 */
async function gatherAuditData(auditUid) {
  const db = getDatabase();

  // Get audit record
  const audit = db.prepare(`
    SELECT * FROM audits WHERE audit_uid = ?
  `).get(auditUid);

  if (!audit) {
    throw new Error('Audit not found');
  }

  // Get scan results
  const scanResults = db.prepare(`
    SELECT * FROM scan_results WHERE audit_id = ?
  `).get(audit.id);

  // Get policy analysis
  const privacyAnalysis = getPolicyAnalysis(audit.id, 'privacy');

  // Get cookie comparison
  const cookieComparison = db.prepare(`
    SELECT * FROM cookie_comparisons WHERE audit_id = ?
  `).get(audit.id);

  // Get risk assessment
  const riskAssessment = db.prepare(`
    SELECT * FROM risk_assessments WHERE audit_id = ?
  `).get(audit.id);

  // Parse JSON fields
  const cookies = scanResults ? JSON.parse(scanResults.cookies_json || '[]') : [];
  const networkRequests = scanResults ? JSON.parse(scanResults.network_requests_json || '[]') : [];
  const bannerViolations = scanResults ? JSON.parse(scanResults.banner_violations_json || '[]') : [];
  const consentModeStatus = scanResults?.consent_mode_v2_status ?
    JSON.parse(scanResults.consent_mode_v2_status) : null;

  return {
    audit,
    scanResults,
    cookies,
    networkRequests,
    bannerViolations,
    consentModeStatus,
    privacyAnalysis,
    cookieComparison: cookieComparison ? {
      declared: JSON.parse(cookieComparison.declared_cookies_json || '[]'),
      undeclared: JSON.parse(cookieComparison.undeclared_cookies_json || '[]'),
      missing: JSON.parse(cookieComparison.mismatched_retention_json || '[]')
    } : null,
    riskAssessment: riskAssessment ? {
      ...riskAssessment,
      violations_json: JSON.parse(riskAssessment.violations_json || '{}')
    } : null
  };
}

/**
 * Transform data to match gdpr-report-template.html structure
 * @param {Object} data - Raw audit data
 * @returns {Object} Template-compatible data
 */
function transformDataForTemplate(data) {
  const {
    audit,
    cookies,
    networkRequests,
    bannerViolations,
    privacyAnalysis,
    cookieComparison,
    riskAssessment
  } = data;

  // 1. Executive Summary
  const overallScore = audit.overall_score || 0;
  const criticalViolations = bannerViolations.filter(v => v.severity === 'critical');
  const undeclaredCookies = cookieComparison?.undeclared || [];
  const passedCriteria = privacyAnalysis?.criteria?.filter(c => c.score >= c.weight) || [];

  // 2. Scan Results
  const trackingBeforeConsent = data.scanResults?.tracking_before_consent ? 'YES' : 'NO';
  const preConsentRequests = networkRequests.filter(r => r.beforeConsent);

  // Timeline data for chart
  const timelineData = {
    labels: networkRequests.slice(0, 20).map((r, i) => `R${i + 1}`),
    beforeConsent: networkRequests.slice(0, 20).map(r => r.beforeConsent ? r.timestamp * 1000 : 0),
    afterConsent: networkRequests.slice(0, 20).map(r => !r.beforeConsent ? r.timestamp * 1000 : 0)
  };

  // 3. Privacy Policy Analysis - Group by tier
  const tier1 = privacyAnalysis?.criteria?.filter(c => c.tier === 1) || [];
  const tier2 = privacyAnalysis?.criteria?.filter(c => c.tier === 2) || [];
  const tier3 = privacyAnalysis?.criteria?.filter(c => c.tier === 3) || [];
  const tier4 = privacyAnalysis?.criteria?.filter(c => c.tier === 4) || [];

  const calculateTierPercentage = (criteria) => {
    if (criteria.length === 0) return 100;
    const totalScore = criteria.reduce((sum, c) => sum + c.score, 0);
    const maxScore = criteria.reduce((sum, c) => sum + c.weight, 0);
    return Math.round((totalScore / maxScore) * 100);
  };

  // 4. Cookie Comparison
  const detectedCookies = cookies.map(cookie => {
    const isDeclared = cookieComparison?.declared.some(d =>
      d.name.toLowerCase() === cookie.name.toLowerCase()
    );

    return {
      name: cookie.name,
      category: cookie.category || 'Unknown',
      purpose: cookie.purpose || 'Not specified',
      lifespan: cookie.expiry || 'Session',
      status_declared: isDeclared,
      status_undeclared: !isDeclared
    };
  });

  // 5. Consent Compliance Checklist (noyb violations)
  const consentViolations = [
    { rule: 'No tracking before consent', status_pass: !data.scanResults?.tracking_before_consent, status_fail: data.scanResults?.tracking_before_consent, severity: 'critical' },
    { rule: 'Reject button present', status_pass: !bannerViolations.some(v => v.id === 'type_a'), status_fail: bannerViolations.some(v => v.id === 'type_a'), severity: 'critical' },
    { rule: 'No pre-ticked boxes', status_pass: !bannerViolations.some(v => v.id === 'type_b'), status_fail: bannerViolations.some(v => v.id === 'type_b'), severity: 'critical' },
    { rule: 'Fair button design', status_pass: !bannerViolations.some(v => ['type_c', 'type_d', 'type_e'].includes(v.id)), status_fail: bannerViolations.some(v => ['type_c', 'type_d', 'type_e'].includes(v.id)), severity: 'high' },
    { rule: 'No legitimate interest for ads', status_pass: !bannerViolations.some(v => v.id === 'type_h'), status_fail: bannerViolations.some(v => v.id === 'type_h'), severity: 'critical' },
    { rule: 'Cookies properly categorized', status_pass: !bannerViolations.some(v => v.id === 'type_i'), status_fail: bannerViolations.some(v => v.id === 'type_i'), severity: 'medium' },
    { rule: 'Consent withdrawal available', status_pass: !bannerViolations.some(v => v.id === 'type_k'), status_fail: bannerViolations.some(v => v.id === 'type_k'), severity: 'high' }
  ];

  // 6. Risk Assessment
  const riskBreakdown = [
    {
      category: 'Tracking Before Consent',
      percentage: data.scanResults?.tracking_before_consent ? 100 : 0,
      description: data.scanResults?.tracking_before_consent ?
        `${preConsentRequests.length} tracking requests detected before user consent` :
        'No tracking before consent detected',
      severity: data.scanResults?.tracking_before_consent ? 'critical' : 'low'
    },
    {
      category: 'Cookie Banner Compliance',
      percentage: Math.round(((8 - bannerViolations.length) / 8) * 100),
      description: `${bannerViolations.length} violations found in cookie banner implementation`,
      severity: bannerViolations.length > 3 ? 'critical' : bannerViolations.length > 0 ? 'high' : 'low'
    },
    {
      category: 'Privacy Policy Completeness',
      percentage: privacyAnalysis?.percentage || 0,
      description: `${privacyAnalysis?.criteria?.length || 0} GDPR criteria evaluated`,
      severity: (privacyAnalysis?.percentage || 0) < 50 ? 'critical' : (privacyAnalysis?.percentage || 0) < 70 ? 'high' : 'medium'
    },
    {
      category: 'Cookie Declaration Accuracy',
      percentage: cookieComparison ? Math.round((cookieComparison.declared.length / Math.max(cookies.length, 1)) * 100) : 0,
      description: undeclaredCookies.length > 0 ?
        `${undeclaredCookies.length} undeclared cookies found` :
        'All cookies properly declared',
      severity: undeclaredCookies.length > 10 ? 'high' : undeclaredCookies.length > 0 ? 'medium' : 'low'
    }
  ];

  // 7. Recommendations
  const recommendations = generateRecommendations(data);

  // 8. Technical Details
  const scanDate = new Date(audit.created_at);

  return {
    // Header & Meta
    website: audit.website_url,
    scan_date: scanDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    scan_date_full: scanDate.toLocaleString('en-US'),
    scan_id: audit.audit_uid,
    scanner_version: '1.0.0',
    target_url: audit.website_url,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',

    // Executive Summary
    overall_score: overallScore,
    risk_level: getRiskLevelClass(riskAssessment?.risk_level),
    risk_level_text: riskAssessment?.risk_level || 'Unknown',
    critical_count: criticalViolations.length,
    undeclared_count: undeclaredCookies.length,
    passed_count: passedCriteria.length,
    critical_violations_title: criticalViolations.length > 0 ?
      `${criticalViolations.length} Critical Violations Detected` :
      'No Critical Violations',
    critical_violations_description: criticalViolations.length > 0 ?
      `Your website has ${criticalViolations.length} critical GDPR violations requiring immediate attention.` :
      'Great! No critical violations detected.',
    undeclared_cookies_title: undeclaredCookies.length > 0 ?
      `${undeclaredCookies.length} Undeclared Cookies Found` :
      'All Cookies Declared',
    undeclared_cookies_description: undeclaredCookies.length > 0 ?
      `${undeclaredCookies.length} cookies are active on your website but not listed in your Cookie Policy.` :
      'All detected cookies are properly declared in your Cookie Policy.',
    passed_criteria_title: `${passedCriteria.length} Criteria Passed`,
    passed_criteria_description: `Your Privacy Policy meets ${passedCriteria.length} out of 37 GDPR compliance criteria.`,
    fine_min_eur: formatNumber(riskAssessment?.total_risk_min || 0),
    fine_max_eur: formatNumber(riskAssessment?.total_risk_max || 0),

    // Scan Results
    cookies_detected: cookies.length,
    cookies_declared: cookieComparison?.declared.length || 0,
    tracking_before_consent: trackingBeforeConsent,
    fine_min: formatNumber(riskAssessment?.total_risk_min || 0),
    fine_max: formatNumber(riskAssessment?.total_risk_max || 0),
    timeline_data_json: JSON.stringify(timelineData),

    // Privacy Policy Analysis
    tier1_criteria: tier1.map(c => formatCriterion(c)),
    tier2_criteria: tier2.map(c => formatCriterion(c)),
    tier3_criteria: tier3.map(c => formatCriterion(c)),
    tier4_criteria: tier4.map(c => formatCriterion(c)),
    tier1_percentage: calculateTierPercentage(tier1),
    tier2_percentage: calculateTierPercentage(tier2),
    tier3_percentage: calculateTierPercentage(tier3),
    tier4_percentage: calculateTierPercentage(tier4),
    final_percentage: privacyAnalysis?.percentage || 0,
    final_achieved: privacyAnalysis?.total_score || 0,
    final_total: privacyAnalysis?.max_score || 100,

    // Cookie Comparison
    detected_cookies: detectedCookies,

    // Consent Compliance
    consent_violations: consentViolations,

    // Risk Assessment
    risk_breakdown: riskBreakdown,

    // Recommendations
    recommendations: recommendations
  };
}

/**
 * Format criterion for template
 */
function formatCriterion(criterion) {
  const passed = criterion.score >= criterion.weight;
  return {
    name: criterion.name,
    score: criterion.score,
    max_score: criterion.weight,
    explanation: criterion.recommendation || 'No explanation available',
    status_pass: passed,
    status_warning: !passed && criterion.score > 0,
    status_fail: criterion.score === 0
  };
}

/**
 * Generate recommendations
 */
function generateRecommendations(data) {
  const recommendations = [];

  if (data.scanResults?.tracking_before_consent) {
    recommendations.push({
      title: 'Remove Tracking Before Consent',
      priority: 'critical',
      description: 'Your website loads tracking technologies before user consent, violating ePrivacy Directive Article 5(3).',
      action: 'Delay all tracking script execution until after user accepts cookies. Implement Google Consent Mode V2 with all defaults set to "denied".'
    });
  }

  if (data.bannerViolations.some(v => v.id === 'type_a')) {
    recommendations.push({
      title: 'Add Prominent Reject Button',
      priority: 'critical',
      description: 'Cookie banner lacks an equally prominent "Reject" button, violating GDPR Article 7(4).',
      action: 'Add a "Reject All" button with the same size, color, and visibility as the "Accept" button on the first layer of your cookie banner.'
    });
  }

  if (data.privacyAnalysis && data.privacyAnalysis.percentage < 60) {
    recommendations.push({
      title: 'Update Privacy Policy',
      priority: 'high',
      description: `Privacy Policy scored ${data.privacyAnalysis.percentage}% - below acceptable compliance threshold.`,
      action: 'Update your Privacy Policy to include missing GDPR requirements: legal basis for each processing activity, data retention periods, DPO contact details, and information about automated decision-making.'
    });
  }

  if (data.cookieComparison && data.cookieComparison.undeclared.length > 0) {
    recommendations.push({
      title: 'Declare All Cookies',
      priority: 'high',
      description: `${data.cookieComparison.undeclared.length} cookies detected on website are not listed in Cookie Policy.`,
      action: `Add these cookies to your Cookie Policy: ${data.cookieComparison.undeclared.slice(0, 5).map(c => c.name).join(', ')}`
    });
  }

  return recommendations.slice(0, 10);
}

/**
 * Get risk level CSS class
 */
function getRiskLevelClass(riskLevel) {
  const map = {
    'Critical': 'critical',
    'High': 'high',
    'Medium': 'medium',
    'Low': 'low'
  };
  return map[riskLevel] || 'medium';
}

/**
 * Format number with thousands separator
 */
function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

module.exports = {
  generateReport
};
