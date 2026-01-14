const { analyzeWithClaude } = require('../integrations/claude-api');

/**
 * Generate personalized solutions based on audit findings
 * @param {Object} auditData - Complete audit data
 * @returns {Promise<Array>} Prioritized solutions
 */
async function generateSolutions(auditData) {
  try {
    console.log('💡 Generating personalized solutions...');

    // Aggregate all problems
    const context = buildProblemContext(auditData);

    // Generate solutions using Claude API
    const solutions = await generateWithClaude(context);

    // Validate and enhance solutions
    const validatedSolutions = validateSolutions(solutions);

    console.log(`✅ Generated ${validatedSolutions.length} actionable solutions`);

    return validatedSolutions;
  } catch (error) {
    console.error('❌ Solution generation failed:', error.message);
    // Return fallback solutions instead of throwing
    return generateFallbackSolutions(auditData);
  }
}

/**
 * Build problem context from audit data
 * @param {Object} auditData - Audit data
 * @returns {Object} Problem context
 */
function buildProblemContext(auditData) {
  const problems = [];

  // Scanner violations
  if (auditData.trackingBeforeConsent) {
    problems.push({
      category: 'Technical',
      severity: 'Critical',
      issue: 'Tracking before consent detected',
      details: `${auditData.trackingBeforeConsentCount || 0} tracking requests/cookies set before user interaction`
    });
  }

  // Banner violations
  if (auditData.bannerViolations && auditData.bannerViolations.length > 0) {
    auditData.bannerViolations.forEach(violation => {
      problems.push({
        category: 'Cookie Banner',
        severity: violation.severity,
        issue: violation.name,
        details: violation.description
      });
    });
  }

  // Consent Mode violations
  if (auditData.consentModeIssues && auditData.consentModeIssues.length > 0) {
    problems.push({
      category: 'Consent Mode',
      severity: 'High',
      issue: 'Google Consent Mode V2 issues',
      details: auditData.consentModeIssues.join('; ')
    });
  }

  // Privacy Policy violations
  if (auditData.privacyPolicyScore < 70) {
    const failedCriteria = auditData.privacyPolicyFailedCriteria || [];
    problems.push({
      category: 'Privacy Policy',
      severity: auditData.privacyPolicyScore < 50 ? 'Critical' : 'High',
      issue: `Privacy Policy score: ${auditData.privacyPolicyScore}/100`,
      details: `Failed ${failedCriteria.length} criteria. Top issues: ${failedCriteria.slice(0, 3).map(c => c.name).join(', ')}`
    });
  }

  // Cookie Policy violations
  if (auditData.undeclaredCookies && auditData.undeclaredCookies.length > 0) {
    problems.push({
      category: 'Cookie Policy',
      severity: auditData.undeclaredCookies.length > 10 ? 'High' : 'Medium',
      issue: `${auditData.undeclaredCookies.length} undeclared cookies`,
      details: `Cookies detected but not listed in Cookie Policy: ${auditData.undeclaredCookies.slice(0, 5).map(c => c.name).join(', ')}`
    });
  }

  return {
    problems,
    websiteUrl: auditData.websiteUrl,
    overallScore: auditData.overallScore,
    riskLevel: auditData.riskLevel
  };
}

/**
 * Generate solutions using Claude API
 * @param {Object} context - Problem context
 * @returns {Promise<Array>} Solutions
 */
async function generateWithClaude(context) {
  const prompt = `
You are a GDPR compliance expert. Generate specific, actionable solutions for the following compliance issues.

Website: ${context.websiteUrl}
Overall Compliance Score: ${context.overallScore}/100
Risk Level: ${context.riskLevel}

Detected Issues:
${context.problems.map((p, i) => `${i + 1}. [${p.severity}] ${p.category}: ${p.issue}
   Details: ${p.details}`).join('\n\n')}

Generate 5-10 prioritized solutions. For EACH solution, provide:

1. **Title** (max 8 words, action-oriented)
2. **Priority** (Critical / High / Medium / Low)
3. **Problem** (1 sentence describing the issue)
4. **Action** (2-3 specific steps to fix it)
5. **Impact** (1 sentence on compliance improvement)

STRICT FORMAT:
---
Title: [Action Title]
Priority: [Critical/High/Medium/Low]
Problem: [One sentence]
Action: [Specific steps]
Impact: [Expected outcome]
---

Requirements:
- Be SPECIFIC (mention exact cookie names, policy sections, code changes)
- Be ACTIONABLE (developer/legal team can implement immediately)
- Prioritize by severity and ease of implementation
- Focus on GDPR compliance, not general best practices
- Keep each solution under 150 words total

Example:
---
Title: Remove Pre-Consent Google Analytics Tracking
Priority: Critical
Problem: Google Analytics (_ga, _gid) cookies are set before user consent, violating ePrivacy Directive Art. 5(3).
Action: 1) Wrap all gtag() calls in a consent check function. 2) Only initialize Google Analytics after user clicks "Accept" on cookie banner. 3) Implement Google Consent Mode V2 with default='denied' for analytics_storage.
Impact: Eliminates critical ePrivacy violation, reduces regulatory risk by 60-80%, demonstrates good-faith compliance effort.
---

Generate solutions now:
`;

  try {
    const result = await analyzeWithClaude(prompt, {
      maxTokens: 3000,
      temperature: 0.3,  // Balanced creativity
      useCache: false
    });

    // Parse solutions from response
    const solutions = parseSolutionsFromText(result.text);

    return solutions;
  } catch (error) {
    console.error('Claude API failed for solution generation:', error.message);
    return [];
  }
}

/**
 * Parse solutions from Claude's text response
 * @param {string} text - Claude's response
 * @returns {Array} Parsed solutions
 */
function parseSolutionsFromText(text) {
  const solutions = [];

  // Split by --- separator
  const sections = text.split('---').filter(s => s.trim().length > 0);

  for (const section of sections) {
    const lines = section.split('\n').map(l => l.trim()).filter(l => l);

    const solution = {
      title: '',
      priority: 'Medium',
      problem: '',
      action: '',
      impact: ''
    };

    for (const line of lines) {
      if (line.startsWith('Title:')) {
        solution.title = line.replace('Title:', '').trim();
      } else if (line.startsWith('Priority:')) {
        solution.priority = line.replace('Priority:', '').trim();
      } else if (line.startsWith('Problem:')) {
        solution.problem = line.replace('Problem:', '').trim();
      } else if (line.startsWith('Action:')) {
        solution.action = line.replace('Action:', '').trim();
      } else if (line.startsWith('Impact:')) {
        solution.impact = line.replace('Impact:', '').trim();
      }
    }

    // Only add if at least title and action are present
    if (solution.title && solution.action) {
      solutions.push(solution);
    }
  }

  return solutions;
}

/**
 * Validate and enhance solutions
 * @param {Array} solutions - Raw solutions
 * @returns {Array} Validated solutions
 */
function validateSolutions(solutions) {
  // Normalize priority
  const priorityMap = {
    'critical': 'Critical',
    'high': 'High',
    'medium': 'Medium',
    'low': 'Low'
  };

  return solutions
    .filter(s => s.title && s.action)
    .map(solution => ({
      title: solution.title.substring(0, 100),
      priority: priorityMap[solution.priority.toLowerCase()] || 'Medium',
      problem: solution.problem || 'Compliance issue detected',
      action: solution.action,
      impact: solution.impact || 'Improves GDPR compliance'
    }))
    .sort((a, b) => {
      // Sort by priority
      const priorityOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
}

/**
 * Generate fallback solutions when Claude API fails
 * @param {Object} auditData - Audit data
 * @returns {Array} Fallback solutions
 */
function generateFallbackSolutions(auditData) {
  const solutions = [];

  if (auditData.trackingBeforeConsent) {
    solutions.push({
      title: 'Implement Consent-Before-Tracking',
      priority: 'Critical',
      problem: 'Your website sets tracking cookies before user consent, violating ePrivacy Directive Art. 5(3).',
      action: 'Delay all tracking script execution until after user accepts cookies. Wrap analytics/advertising scripts in consent checks. Implement Google Consent Mode V2 with all defaults set to "denied".',
      impact: 'Eliminates the most severe GDPR violation, significantly reduces fine risk.'
    });
  }

  if (auditData.bannerViolations && auditData.bannerViolations.some(v => v.id === 'type_a')) {
    solutions.push({
      title: 'Add Prominent Reject Button',
      priority: 'Critical',
      problem: 'Cookie banner lacks an equally prominent "Reject" button alongside "Accept", violating GDPR Art. 7(4).',
      action: 'Add a "Reject All" button to the first layer of your cookie banner with the same size, color prominence, and visibility as the "Accept" button.',
      impact: 'Ensures consent is freely given as required by GDPR, addresses noyb Type A violation.'
    });
  }

  if (auditData.privacyPolicyScore && auditData.privacyPolicyScore < 60) {
    solutions.push({
      title: 'Update Privacy Policy for GDPR Compliance',
      priority: 'High',
      problem: `Privacy Policy scored ${auditData.privacyPolicyScore}/100, missing key GDPR requirements.`,
      action: 'Review and update Privacy Policy to include: legal basis for each processing activity, data retention periods, DPO contact details, and information about automated decision-making.',
      impact: 'Meets GDPR transparency obligations under Articles 13-14.'
    });
  }

  if (auditData.undeclaredCookies && auditData.undeclaredCookies.length > 0) {
    solutions.push({
      title: 'Update Cookie Policy with Missing Cookies',
      priority: 'High',
      problem: `${auditData.undeclaredCookies.length} cookies detected on website are not listed in Cookie Policy.`,
      action: `Add the following cookies to your Cookie Policy with their purposes and categories: ${auditData.undeclaredCookies.slice(0, 5).map(c => c.name).join(', ')}${auditData.undeclaredCookies.length > 5 ? '...' : ''}`,
      impact: 'Improves transparency and Cookie Policy accuracy to 100%.'
    });
  }

  if (auditData.consentModeIssues && auditData.consentModeIssues.length > 0) {
    solutions.push({
      title: 'Upgrade to Google Consent Mode V2',
      priority: 'High',
      problem: 'Google Consent Mode V2 is not properly configured or is missing required parameters.',
      action: 'Update gtag consent implementation to include ad_user_data and ad_personalization parameters, set all defaults to "denied", and ensure consent("default") is called before gtag("config").',
      impact: 'Required for Google Analytics/Ads in EEA from March 2024, improves technical compliance score.'
    });
  }

  return solutions.slice(0, 10);
}

/**
 * Format solutions for HTML report
 * @param {Array} solutions - Solutions
 * @returns {string} HTML formatted solutions
 */
function formatSolutionsForReport(solutions) {
  return solutions.map((solution, index) => {
    const priorityClass = {
      'Critical': 'priority-critical',
      'High': 'priority-high',
      'Medium': 'priority-medium',
      'Low': 'priority-low'
    }[solution.priority] || 'priority-medium';

    return `
      <div class="solution-card ${priorityClass}">
        <div class="solution-header">
          <span class="solution-number">${index + 1}</span>
          <h3 class="solution-title">${solution.title}</h3>
          <span class="solution-priority">${solution.priority}</span>
        </div>
        <div class="solution-content">
          <p class="solution-problem"><strong>Problem:</strong> ${solution.problem}</p>
          <p class="solution-action"><strong>Action:</strong> ${solution.action}</p>
          <p class="solution-impact"><strong>Impact:</strong> ${solution.impact}</p>
        </div>
      </div>
    `;
  }).join('\n');
}

module.exports = {
  generateSolutions,
  buildProblemContext,
  generateFallbackSolutions,
  formatSolutionsForReport
};
