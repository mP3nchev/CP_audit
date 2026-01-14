const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../database/db');
const { getPolicyAnalysis } = require('../analyzers/privacy-policy-analyzer');
const {
  processCookieCategoriesChart,
  processCriteriaChart,
  processCookieComparisonChart,
  getScoreColors,
  getGradeCategory,
  getRiskLevelClass,
  getNoybBadgeStyle,
  formatEUR,
  formatDate,
  truncate,
  getStatusIcon,
  getSeverityBadge,
  escapeHtml
} = require('./chart-data-processor');

/**
 * Generate HTML report for an audit
 * @param {string} auditUid - Audit UID
 * @returns {Promise<string>} Complete HTML report
 */
async function generateReport(auditUid) {
  try {
    console.log(`📊 Generating HTML report for audit ${auditUid}...`);

    // Load template
    const templatePath = path.join(__dirname, '../../templates/report-template.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    // Gather all audit data
    const data = await gatherAuditData(auditUid);

    // Inject data into template
    template = injectData(template, data);

    console.log(`✅ Report generated successfully (${(template.length / 1024).toFixed(2)} KB)`);

    return template;
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
  const cookieAnalysis = getPolicyAnalysis(audit.id, 'cookie');

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

  const violationsData = riskAssessment ? JSON.parse(riskAssessment.violations_json || '{}') : {};

  return {
    audit,
    scanResults,
    cookies,
    networkRequests,
    bannerViolations,
    consentModeStatus,
    privacyAnalysis,
    cookieAnalysis,
    cookieComparison: cookieComparison ? {
      declared: JSON.parse(cookieComparison.declared_cookies_json || '[]'),
      undeclared: JSON.parse(cookieComparison.undeclared_cookies_json || '[]'),
      missing: JSON.parse(cookieComparison.mismatched_retention_json || '[]')
    } : null,
    riskAssessment: riskAssessment ? {
      ...riskAssessment,
      violations: violationsData.articles || [],
      aggravating_factors: violationsData.aggravating_factors || [],
      mitigating_factors: violationsData.mitigating_factors || [],
      cited_precedents: violationsData.cited_precedents || []
    } : null
  };
}

/**
 * Inject data into template
 * @param {string} template - HTML template
 * @param {Object} data - Audit data
 * @returns {string} Populated template
 */
function injectData(template, data) {
  const {
    audit,
    cookies,
    networkRequests,
    bannerViolations,
    consentModeStatus,
    privacyAnalysis,
    cookieComparison,
    riskAssessment
  } = data;

  // Basic metadata
  template = template.replace(/{{websiteUrl}}/g, escapeHtml(audit.website_url));
  template = template.replace(/{{auditId}}/g, escapeHtml(audit.audit_uid));
  template = template.replace(/{{auditDate}}/g, formatDate(audit.created_at));
  template = template.replace(/{{reportDate}}/g, formatDate(new Date().toISOString()));

  // Overall score
  const overallScore = audit.overall_score || 0;
  const scoreGrade = audit.score_grade || 'F';
  const scoreColors = getScoreColors(scoreGrade);
  const scoreCategory = getGradeCategory(scoreGrade);

  template = template.replace(/{{overallScore}}/g, overallScore);
  template = template.replace(/{{scoreGrade}}/g, scoreGrade);
  template = template.replace(/{{scoreCategory}}/g, scoreCategory);
  template = template.replace(/{{scoreColor}}/g, scoreColors.color);
  template = template.replace(/{{scoreColorDark}}/g, scoreColors.dark);

  // Component scores (mock calculation from overall data)
  const privacyScore = privacyAnalysis ? Math.round(privacyAnalysis.percentage) : 0;
  const bannerScore = Math.round(((8 - bannerViolations.length) / 8) * 100);
  const technicalScore = data.scanResults?.tracking_before_consent ? 0 : 100;
  const cookiePolicyScore = cookieComparison ?
    Math.round((cookieComparison.declared.length / Math.max(cookies.length, 1)) * 100) : 50;

  template = template.replace(/{{privacyPolicyScore}}/g, privacyScore);
  template = template.replace(/{{cookieBannerScore}}/g, bannerScore);
  template = template.replace(/{{technicalScore}}/g, technicalScore);
  template = template.replace(/{{cookiePolicyScore}}/g, cookiePolicyScore);

  // Risk data
  if (riskAssessment) {
    template = template.replace(/{{riskLevel}}/g, riskAssessment.risk_level || 'Unknown');
    template = template.replace(/{{riskMin}}/g, formatEUR(riskAssessment.total_risk_min || 0));
    template = template.replace(/{{riskMax}}/g, formatEUR(riskAssessment.total_risk_max || 0));
    template = template.replace(/{{riskLevelClass}}/g, getRiskLevelClass(riskAssessment.risk_level));
    template = template.replace(/{{confidenceLevel}}/g, 'Medium');
  } else {
    template = template.replace(/{{riskLevel}}/g, 'Unknown');
    template = template.replace(/{{riskMin}}/g, '0');
    template = template.replace(/{{riskMax}}/g, '0');
    template = template.replace(/{{riskLevelClass}}/g, 'medium');
    template = template.replace(/{{confidenceLevel}}/g, 'Low');
  }

  // Scanner results
  template = template.replace(/{{totalCookies}}/g, cookies.length);
  const trackingBeforeConsent = data.scanResults?.tracking_before_consent;
  template = template.replace(/{{trackingStatus}}/g, trackingBeforeConsent ? 'YES' : 'NO');
  template = template.replace(/{{trackingColor}}/g, trackingBeforeConsent ? '#ef4444' : '#10b981');
  const preConsentRequests = networkRequests.filter(r => r.beforeConsent).length;
  template = template.replace(/{{preConsentRequests}}/g, preConsentRequests);

  // Charts
  const cookieChart = processCookieCategoriesChart(cookies);
  template = template.replace(/{{cookieCategoriesLabels}}/g, cookieChart.labels);
  template = template.replace(/{{cookieCategoriesData}}/g, cookieChart.data);

  if (privacyAnalysis && privacyAnalysis.criteria) {
    const criteriaChart = processCriteriaChart(privacyAnalysis.criteria);
    template = template.replace(/{{criteriaLabels}}/g, criteriaChart.labels);
    template = template.replace(/{{criteriaScores}}/g, criteriaChart.scores);
  } else {
    template = template.replace(/{{criteriaLabels}}/g, '[]');
    template = template.replace(/{{criteriaScores}}/g, '[]');
  }

  if (cookieComparison) {
    const comparisonChart = processCookieComparisonChart({
      matched: cookieComparison.declared,
      undeclared: cookieComparison.undeclared,
      missing: cookieComparison.missing
    });
    template = template.replace(/{{cookieComparisonData}}/g, comparisonChart.data);
  } else {
    template = template.replace(/{{cookieComparisonData}}/g, '[0, 0, 0]');
  }

  // Tables
  template = template.replace(/{{cookieTableRows}}/g, buildCookieTable(cookies));
  template = template.replace(/{{criteriaTableRows}}/g, buildCriteriaTable(privacyAnalysis));
  template = template.replace(/{{precedentsTableRows}}/g, buildPrecedentsTable(riskAssessment));

  // noyb violations
  const noybPassedCount = 8 - bannerViolations.length;
  const noybPercentage = Math.round((noybPassedCount / 8) * 100);
  const noybBadge = getNoybBadgeStyle(noybPercentage);

  template = template.replace(/{{noybPassedCount}}/g, noybPassedCount);
  template = template.replace(/{{noybPercentage}}/g, noybPercentage);
  template = template.replace(/{{noybBadgeClass}}/g, noybBadge.class);
  template = template.replace(/{{noybBarColor}}/g, noybBadge.color);
  template = template.replace(/{{noybViolationCards}}/g, buildNoybViolationCards(bannerViolations));

  // Consent Mode
  template = template.replace(/{{consentModeIcon}}/g, consentModeStatus?.compliant ? '✓' : '✗');
  template = template.replace(/{{consentModeStatus}}/g,
    consentModeStatus?.detected ?
      (consentModeStatus.compliant ? 'V2 Compliant' : 'V2 Issues Detected') :
      'Not Detected'
  );
  template = template.replace(/{{consentModeMessage}}/g,
    consentModeStatus?.detected ?
      (consentModeStatus.compliant ? 'Google Consent Mode V2 is properly configured' : 'Configuration issues found') :
      'Google Consent Mode not implemented'
  );
  template = template.replace(/{{consentModeBackground}}/g,
    consentModeStatus?.compliant ? '#d1fae5' : '#fef2f2'
  );
  template = template.replace(/{{consentModeBorder}}/g,
    consentModeStatus?.compliant ? '#a7f3d0' : '#fecaca'
  );
  template = template.replace(/{{consentModeDetails}}/g, buildConsentModeDetails(consentModeStatus));

  // Cookie comparison content
  template = template.replace(/{{cookieComparisonContent}}/g, buildCookieComparisonContent(cookieComparison));

  // Risk articles
  template = template.replace(/{{articleBadges}}/g, buildArticleBadges(riskAssessment));

  // Solutions (generate mock solutions if not available)
  template = template.replace(/{{solutionCards}}/g, buildSolutionCards(data));

  return template;
}

/**
 * Build cookie table rows
 */
function buildCookieTable(cookies) {
  if (!cookies || cookies.length === 0) {
    return '<tr><td colspan="5" style="text-align: center; color: #6b7280;">No cookies detected</td></tr>';
  }

  return cookies.slice(0, 50).map(cookie => `
    <tr>
      <td><code>${escapeHtml(cookie.name)}</code></td>
      <td>${escapeHtml(cookie.domain)}</td>
      <td>${getSeverityBadge(cookie.category)}</td>
      <td>${cookie.type === 'third-party' ? '3rd Party' : '1st Party'}</td>
      <td>${cookie.setBeforeConsent ? '<span style="color: #ef4444;">YES</span>' : '<span style="color: #10b981;">NO</span>'}</td>
    </tr>
  `).join('');
}

/**
 * Build criteria table rows
 */
function buildCriteriaTable(privacyAnalysis) {
  if (!privacyAnalysis || !privacyAnalysis.criteria) {
    return '<tr><td colspan="5" style="text-align: center; color: #6b7280;">Policy analysis not available</td></tr>';
  }

  return privacyAnalysis.criteria.slice(0, 37).map(criterion => {
    const passed = criterion.score >= criterion.weight;
    return `
    <tr>
      <td>${escapeHtml(criterion.name)}</td>
      <td><span class="badge badge-${criterion.tier === 1 ? 'critical' : criterion.tier === 2 ? 'high' : 'medium'}">Tier ${criterion.tier}</span></td>
      <td>${criterion.score}/${criterion.weight}</td>
      <td>${getStatusIcon(passed)}</td>
      <td>${truncate(escapeHtml(criterion.recommendation || 'No recommendation'), 100)}</td>
    </tr>
  `}).join('');
}

/**
 * Build precedents table rows
 */
function buildPrecedentsTable(riskAssessment) {
  if (!riskAssessment || !riskAssessment.cited_precedents || riskAssessment.cited_precedents.length === 0) {
    return '<tr><td colspan="5" style="text-align: center; color: #6b7280;">No precedents available</td></tr>';
  }

  return riskAssessment.cited_precedents.map(p => `
    <tr>
      <td>${escapeHtml(p.case_number || 'N/A')}</td>
      <td>${escapeHtml(p.dpa || 'Unknown')}</td>
      <td>${formatDate(p.decision_date)}</td>
      <td style="font-weight: 600;">€${formatEUR(p.fine_eur || 0)}</td>
      <td>${truncate(escapeHtml(p.summary || 'No summary'), 150)}</td>
    </tr>
  `).join('');
}

/**
 * Build noyb violation cards
 */
function buildNoybViolationCards(violations) {
  if (!violations || violations.length === 0) {
    return '<div style="padding: 20px; background: #d1fae5; border-radius: 8px; color: #059669; text-align: center;">✓ All noyb checks passed!</div>';
  }

  return violations.map(v => `
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin-bottom: 15px;">
      <div style="display: flex; align-items: center; margin-bottom: 10px;">
        <span style="font-size: 24px; margin-right: 10px;">✗</span>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 16px;">${escapeHtml(v.name)}</div>
          <div style="font-size: 12px; color: #6b7280;">${escapeHtml(v.id?.toUpperCase())}</div>
        </div>
        ${getSeverityBadge(v.severity)}
      </div>
      <p style="color: #6b7280; margin-bottom: 10px;">${escapeHtml(v.description)}</p>
      <div style="font-size: 12px; color: #4b5563;"><strong>Legal Basis:</strong> ${escapeHtml(v.legal_basis)}</div>
    </div>
  `).join('');
}

/**
 * Build consent mode details
 */
function buildConsentModeDetails(consentModeStatus) {
  if (!consentModeStatus || !consentModeStatus.detected) {
    return '<p style="color: #6b7280;">Google Consent Mode not detected on this website.</p>';
  }

  const issues = consentModeStatus.issues || [];

  if (issues.length === 0) {
    return '<p style="color: #059669;">All parameters configured correctly.</p>';
  }

  return `
    <h4 style="margin-bottom: 10px;">Issues Found:</h4>
    <ul style="margin-left: 20px; color: #6b7280;">
      ${issues.map(issue => `<li style="margin-bottom: 5px;">${escapeHtml(issue)}</li>`).join('')}
    </ul>
  `;
}

/**
 * Build cookie comparison content
 */
function buildCookieComparisonContent(cookieComparison) {
  if (!cookieComparison) {
    return '<p style="color: #6b7280;">Cookie policy comparison not available.</p>';
  }

  return `
    <div style="margin-top: 30px;">
      <h3 style="margin-bottom: 15px;">Undeclared Cookies (${cookieComparison.undeclared.length})</h3>
      ${cookieComparison.undeclared.length > 0 ?
        `<div style="background: #fef2f2; padding: 15px; border-radius: 8px;">
          ${cookieComparison.undeclared.slice(0, 10).map(c => `<code style="display: inline-block; margin: 5px; padding: 5px 10px; background: white; border-radius: 4px;">${escapeHtml(c.name)}</code>`).join('')}
        </div>` :
        '<p style="color: #059669;">✓ All cookies are declared in Cookie Policy</p>'
      }
    </div>
  `;
}

/**
 * Build article badges
 */
function buildArticleBadges(riskAssessment) {
  if (!riskAssessment || !riskAssessment.violations || riskAssessment.violations.length === 0) {
    return '<span class="badge badge-pass">No violations detected</span>';
  }

  return riskAssessment.violations.map(article =>
    `<span class="badge badge-high">${escapeHtml(article)}</span>`
  ).join('\n');
}

/**
 * Build solution cards
 */
function buildSolutionCards(data) {
  // Generate mock solutions based on violations
  const solutions = [];

  if (data.scanResults?.tracking_before_consent) {
    solutions.push({
      title: 'Remove Tracking Before Consent',
      priority: 'Critical',
      problem: 'Tracking technologies are loaded before user consent.',
      action: 'Delay all tracking script execution until after user accepts cookies. Implement Google Consent Mode V2 with defaults set to "denied".',
      impact: 'Eliminates the most severe GDPR violation.'
    });
  }

  if (data.bannerViolations.length > 0) {
    solutions.push({
      title: 'Fix Cookie Banner Violations',
      priority: 'Critical',
      problem: `${data.bannerViolations.length} noyb violations detected in cookie banner.`,
      action: 'Add equally prominent Reject button, remove pre-ticked boxes, ensure fair design.',
      impact: 'Achieves consent mechanism compliance.'
    });
  }

  if (!solutions.length) {
    return '<p style="color: #6b7280;">Great job! No critical issues detected.</p>';
  }

  return solutions.map((sol, i) => `
    <div class="solution-card priority-${sol.priority.toLowerCase()}">
      <div class="solution-header">
        <div style="display: flex; align-items: center; flex: 1;">
          <div class="solution-number">${i + 1}</div>
          <div class="solution-title">${escapeHtml(sol.title)}</div>
        </div>
        <span class="solution-priority badge badge-${sol.priority.toLowerCase()}">${sol.priority}</span>
      </div>
      <div class="solution-content">
        <p><strong>Problem:</strong> ${escapeHtml(sol.problem)}</p>
        <p><strong>Action:</strong> ${escapeHtml(sol.action)}</p>
        <p><strong>Impact:</strong> ${escapeHtml(sol.impact)}</p>
      </div>
    </div>
  `).join('');
}

module.exports = {
  generateReport,
  gatherAuditData
};
