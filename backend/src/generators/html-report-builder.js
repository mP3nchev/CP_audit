const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { getDatabase } = require('../database/db');
const { getPolicyAnalysis } = require('../analyzers/privacy-policy-analyzer');

// Register Handlebars helpers
Handlebars.registerHelper('if_eq', function(a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('if_ne', function(a, b, options) {
  return a !== b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('if_gt', function(a, b, options) {
  return a > b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('if_gte', function(a, b, options) {
  return a >= b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('if_lt', function(a, b, options) {
  return a < b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('if_lte', function(a, b, options) {
  return a <= b ? options.fn(this) : options.inverse(this);
});

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
  const complianceScore = scanResults?.compliance_score_json ?
    JSON.parse(scanResults.compliance_score_json) : null;
  const requestCategorization = scanResults?.request_categorization_json ?
    JSON.parse(scanResults.request_categorization_json) : null;
  const timelineData = scanResults?.timeline_json ?
    JSON.parse(scanResults.timeline_json) : null;
  const consentSimulation = scanResults?.consent_simulation_json ?
    JSON.parse(scanResults.consent_simulation_json) : null;

  return {
    audit,
    scanResults,
    cookies,
    networkRequests,
    bannerViolations,
    consentModeStatus,
    complianceScore,
    requestCategorization,
    timelineData,
    consentSimulation,
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
 * Aggregate critical violations from all sources
 * @param {Object} data - Raw audit data
 * @returns {Array} Critical violations list
 */
function aggregateCriticalViolations(data) {
  const criticalViolations = [];

  // 1. Critical banner violations (NOYB 8-point checklist)
  const criticalBannerViolations = (data.bannerViolations || []).filter(v => v.severity === 'critical');
  criticalBannerViolations.forEach(v => {
    criticalViolations.push({
      source: 'Cookie Banner',
      type: v.id || 'Unknown',
      title: v.description || 'Banner Violation',
      description: v.details || v.description,
      severity: 'critical',
      article: v.article || 'GDPR Art. 7',
      dpa_reference: v.dpa_reference || null,
      icon: '🍪'
    });
  });

  // 2. Tracking before consent
  if (data.scanResults?.tracking_before_consent) {
    const timelineViolations = data.timelineData?.violations || [];
    const trackingCount = timelineViolations.length;

    criticalViolations.push({
      source: 'Technical Implementation',
      type: 'tracking_before_consent',
      title: 'Tracking Before Consent',
      description: `${trackingCount} tracking requests/cookies detected before user consent was obtained. This violates ePrivacy Directive Article 5(3) and GDPR Article 7.`,
      severity: 'critical',
      article: 'ePrivacy Dir. 5(3), GDPR Art. 7',
      dpa_reference: 'Multiple DPA decisions (France, Belgium, Austria)',
      icon: '📡'
    });
  }

  // 3. Google Consent Mode v2 issues
  if (data.consentModeStatus) {
    if (!data.consentModeStatus.detected && data.consentModeStatus.ga4Present) {
      criticalViolations.push({
        source: 'Google Consent Mode',
        type: 'consent_mode_missing',
        title: 'Google Consent Mode v2 Not Implemented',
        description: 'Google Analytics 4 detected but Consent Mode v2 is not implemented. This is required for GDPR compliance when using Google services in the EEA.',
        severity: 'high',
        article: 'GDPR Art. 7, ePrivacy Dir. 5(3)',
        dpa_reference: 'Google Analytics rulings (Austria, France, Italy)',
        icon: '🎯'
      });
    } else if (data.consentModeStatus.detected && !data.consentModeStatus.compliant) {
      const issues = data.consentModeStatus.issues || [];
      criticalViolations.push({
        source: 'Google Consent Mode',
        type: 'consent_mode_misconfigured',
        title: 'Google Consent Mode v2 Misconfigured',
        description: `Consent Mode v2 is implemented but not GDPR-compliant: ${issues.join(', ')}`,
        severity: 'critical',
        article: 'GDPR Art. 7',
        dpa_reference: null,
        icon: '⚠️'
      });
    }
  }

  // 4. Consent simulation violations (Accept/Reject symmetry)
  if (data.complianceScore?.components?.cookieBanner?.details) {
    const details = data.complianceScore.components.cookieBanner.details;
    const clickImbalanceMatch = details.match(/(\d+) click imbalance/);
    if (clickImbalanceMatch && parseInt(clickImbalanceMatch[1]) > 2) {
      criticalViolations.push({
        source: 'Consent Banner UX',
        type: 'reject_harder_than_accept',
        title: 'Rejecting Consent is Harder Than Accepting',
        description: `It takes ${clickImbalanceMatch[1]} more clicks to reject cookies than to accept them. GDPR requires withdrawing consent to be as easy as giving it.`,
        severity: 'high',
        article: 'GDPR Art. 7(3)',
        dpa_reference: 'CNIL (France) - Planet49 case guidance',
        icon: '🖱️'
      });
    }
  }

  // 5. Score caps applied (indicating critical structural issues)
  if (data.complianceScore?.capsApplied && data.complianceScore.capsApplied.length > 0) {
    data.complianceScore.capsApplied.forEach(cap => {
      if (cap.includes('Multiple critical violations')) {
        criticalViolations.push({
          source: 'Overall Compliance',
          type: 'multiple_critical_violations',
          title: 'Multiple Critical GDPR Violations',
          description: 'Your website has multiple critical GDPR violations that compound the compliance risk. Immediate action is required.',
          severity: 'critical',
          article: 'GDPR Multiple Articles',
          dpa_reference: null,
          icon: '🚨'
        });
      }
    });
  }

  // Sort by severity: critical first, then high
  criticalViolations.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return criticalViolations;
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
    riskAssessment,
    complianceScore,
    consentSimulation
  } = data;

  // 1. Executive Summary - Aggregate ALL critical violations
  const overallScore = complianceScore?.overallScore || audit.overall_score || 0;
  const scoreGrade = complianceScore?.grade || audit.score_grade || 'F';
  const allCriticalViolations = aggregateCriticalViolations(data);
  const criticalViolations = bannerViolations.filter(v => v.severity === 'critical');
  const undeclaredCookies = cookieComparison?.undeclared || [];
  const passedCriteria = privacyAnalysis?.criteria?.filter(c => c.score >= c.weight) || [];

  // 2. Scan Results
  const trackingBeforeConsent = data.scanResults?.tracking_before_consent ? 'YES' : 'NO';
  const preConsentRequests = networkRequests.filter(r => r.beforeConsent && r.isTracking);
  const postConsentRequests = networkRequests.filter(r => !r.beforeConsent && r.isTracking);
  const preConsentCookies = cookies.filter(c =>
    c.detectedAt && c.detectedAt < (data.timelineData?.zones?.find(z => z.name === 'Cookie Banner Appeared')?.start || Infinity)
  );

  // Prepare detailed tracking before consent list
  const trackingBeforeConsentDetails = preConsentRequests.map(req => {
    try {
      const url = new URL(req.url);
      return {
        type: 'Network Request',
        name: url.hostname,
        url: req.url.length > 80 ? req.url.substring(0, 80) + '...' : req.url,
        timestamp: `${(req.timestamp).toFixed(2)}s`,
        category: req.resourceType || 'unknown'
      };
    } catch (e) {
      return {
        type: 'Network Request',
        name: 'Unknown',
        url: req.url.substring(0, 80),
        timestamp: `${(req.timestamp).toFixed(2)}s`,
        category: req.resourceType || 'unknown'
      };
    }
  });

  // Add cookies detected before consent
  data.timelineData?.violations?.filter(v => v.type === 'cookie').forEach(violation => {
    trackingBeforeConsentDetails.push({
      type: 'Cookie',
      name: violation.name,
      url: violation.domain || 'N/A',
      timestamp: `${(violation.timestamp / 1000).toFixed(2)}s`,
      category: violation.category || 'tracking'
    });
  });

  const trackingBeforeConsentCount = trackingBeforeConsentDetails.length;

  // Timeline data for chart - use timeline events from database
  const timelineEvents = data.timelineData?.events || [];
  const timelineData = {
    labels: timelineEvents.slice(0, 30).map((e, i) => {
      if (e.type === 'milestone') return e.name.substring(0, 10);
      return `${e.type === 'cookie' ? '🍪' : '📡'}${i}`;
    }),
    beforeConsent: timelineEvents.slice(0, 30).map(e => e.beforeConsent ? e.timestamp : 0),
    afterConsent: timelineEvents.slice(0, 30).map(e => !e.beforeConsent && e.type !== 'milestone' ? e.timestamp : 0)
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
    score_grade: scoreGrade,
    risk_level: getRiskLevelClass(riskAssessment?.risk_level),
    risk_level_text: riskAssessment?.risk_level || 'Unknown',
    critical_count: allCriticalViolations.length,
    all_critical_violations: allCriticalViolations,
    undeclared_count: undeclaredCookies.length,
    passed_count: passedCriteria.length,
    critical_violations_title: allCriticalViolations.length > 0 ?
      `${allCriticalViolations.length} Critical Violations Detected` :
      'No Critical Violations',
    critical_violations_description: allCriticalViolations.length > 0 ?
      `Your website has ${allCriticalViolations.length} critical GDPR violations requiring immediate attention.` :
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
    tracking_before_consent_count: trackingBeforeConsentCount,
    tracking_after_consent_count: postConsentRequests.length,
    tracking_before_consent_items: trackingBeforeConsentDetails,
    fine_min: formatNumber(riskAssessment?.total_risk_min || 0),
    fine_max: formatNumber(riskAssessment?.total_risk_max || 0),
    timeline_data_json: JSON.stringify(timelineData),

    // Consent Mode V2
    consent_mode_detected: data.consentModeStatus?.detected || false,
    consent_mode_compliant: data.consentModeStatus?.compliant || false,
    consent_mode_version: data.consentModeStatus?.version || 'Not detected',
    consent_mode_method: data.consentModeStatus?.detectionMethod || 'N/A',
    consent_mode_confidence: data.consentModeStatus?.confidence || 0,
    consent_mode_has_updates: data.consentModeStatus?.hasUpdates || false,
    consent_mode_ad_storage: data.consentModeStatus?.defaultStates?.ad_storage || null,
    consent_mode_analytics_storage: data.consentModeStatus?.defaultStates?.analytics_storage || null,
    consent_mode_ad_user_data: data.consentModeStatus?.defaultStates?.ad_user_data || null,
    consent_mode_ad_personalization: data.consentModeStatus?.defaultStates?.ad_personalization || null,
    consent_mode_issues: data.consentModeStatus?.issues || [],
    consent_mode_ga4_present: data.consentModeStatus?.ga4Present || false,

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

    // Compliance Score Breakdown (from Problem 7)
    compliance_components: complianceScore && complianceScore.components ? [
      complianceScore.components.privacyPolicy ? {
        name: 'Privacy Policy',
        score: complianceScore.components.privacyPolicy.score,
        weight: Math.round(complianceScore.weights.privacyPolicy * 100),
        contribution: complianceScore.components.privacyPolicy.contribution.toFixed(1),
        details: complianceScore.components.privacyPolicy.details
      } : null,
      complianceScore.components.cookieBanner ? {
        name: 'Cookie Banner',
        score: complianceScore.components.cookieBanner.score,
        weight: Math.round(complianceScore.weights.cookieBanner * 100),
        contribution: complianceScore.components.cookieBanner.contribution.toFixed(1),
        details: complianceScore.components.cookieBanner.details
      } : null,
      complianceScore.components.technical ? {
        name: 'Technical Implementation',
        score: complianceScore.components.technical.score,
        weight: Math.round(complianceScore.weights.technical * 100),
        contribution: complianceScore.components.technical.contribution.toFixed(1),
        details: complianceScore.components.technical.details
      } : null,
      complianceScore.components.cookiePolicy ? {
        name: 'Cookie Policy Accuracy',
        score: complianceScore.components.cookiePolicy.score,
        weight: Math.round(complianceScore.weights.cookiePolicy * 100),
        contribution: complianceScore.components.cookiePolicy.contribution.toFixed(1),
        details: complianceScore.components.cookiePolicy.details
      } : null
    ].filter(component => component !== null) : [],
    score_caps_applied: complianceScore?.capsApplied || [],

    // Tracking Vendor Breakdown (from Problem 5)
    tracking_vendors: data.requestCategorization?.vendorBreakdown ?
      Object.entries(data.requestCategorization.vendorBreakdown)
        .map(([vendor, stats]) => ({
          vendor,
          tracking: stats.tracking,
          resources: stats.resources,
          total: stats.total
        }))
        .sort((a, b) => b.tracking - a.tracking)
        .slice(0, 10) : [],
    definite_tracking_count: data.requestCategorization?.categoryA?.count || 0,
    suspicious_tracking_count: data.requestCategorization?.categoryB?.count || 0,

    // Recommendations
    recommendations: recommendations,

    // Human-Assisted Consent Simulation (v1.0)
    consent_simulation_enabled: consentSimulation && !consentSimulation.skipped,
    consent_simulation_skipped: consentSimulation?.skipped || false,
    consent_simulation_skip_reason: consentSimulation?.reason || null,
    consent_simulation_error: consentSimulation?.error || null,
    consent_simulation_reject_cookies: consentSimulation?.reject?.cookiesAfterConsent || 0,
    consent_simulation_accept_cookies: consentSimulation?.accept?.cookiesAfterConsent || 0,
    consent_simulation_new_cookies: consentSimulation?.comparison?.cookieDifference || 0,
    consent_simulation_new_cookies_list: consentSimulation?.comparison?.newCookies || [],
    consent_simulation_reject_requests: consentSimulation?.reject?.networkRequests || 0,
    consent_simulation_accept_requests: consentSimulation?.accept?.networkRequests || 0,
    consent_simulation_new_domains: [], // TODO: Extract from comparison
    consent_simulation_duration: consentSimulation?.duration || 0,

    // Consent Monitoring Data (v2.0)
    monitoring_enabled: data.scanResults?.monitoring_data_json ? true : false,
    monitoring_violations: data.scanResults?.monitoring_analysis_json ?
      JSON.parse(data.scanResults.monitoring_analysis_json).violations || [] : [],
    monitoring_critical_violations: data.scanResults?.monitoring_analysis_json ?
      JSON.parse(data.scanResults.monitoring_analysis_json).summary?.criticalViolations || 0 : 0,
    monitoring_gtag_calls: data.scanResults?.monitoring_data_json ?
      JSON.parse(data.scanResults.monitoring_data_json).gtagCalls?.length || 0 : 0,
    monitoring_datalayer_events: data.scanResults?.monitoring_data_json ?
      JSON.parse(data.scanResults.monitoring_data_json).dataLayerEvents?.length || 0 : 0,
    monitoring_storage_writes: data.scanResults?.monitoring_data_json ?
      JSON.parse(data.scanResults.monitoring_data_json).storageWrites?.length || 0 : 0,

    // Detected Vendors (v2.0)
    detected_vendors: data.scanResults?.detected_vendors_json ?
      JSON.parse(data.scanResults.detected_vendors_json).map(vendor => ({
        name: vendor.name,
        category: vendor.category,
        confidence: vendor.confidence,
        violation: vendor.violation || false,
        before_consent: vendor.beforeConsent || false,
        first_seen: vendor.firstSeen ? (vendor.firstSeen / 1000).toFixed(2) + 's' : 'N/A',
        evidence_count: vendor.matches || 0
      })) : [],
    vendor_violations_count: data.scanResults?.vendor_summary_json ?
      JSON.parse(data.scanResults.vendor_summary_json).violations?.length || 0 : 0,
    vendor_total_count: data.scanResults?.vendor_summary_json ?
      JSON.parse(data.scanResults.vendor_summary_json).total || 0 : 0,
    vendor_requires_consent_count: data.scanResults?.vendor_summary_json ?
      JSON.parse(data.scanResults.vendor_summary_json).requiresConsent || 0 : 0
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
