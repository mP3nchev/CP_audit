const { getDatabase } = require('../database/db');

/**
 * Assess GDPR compliance risk and calculate potential fines
 * @param {Object} violations - All detected violations
 * @param {string} jurisdiction - User's jurisdiction (default: 'EU')
 * @param {number} annualRevenue - Company annual revenue in EUR (optional)
 * @returns {Promise<Object>} Risk assessment
 */
async function assessRisk(violations, jurisdiction = 'EU', annualRevenue = null) {
  try {
    console.log('⚖️  Assessing GDPR compliance risk...');

    // Map violations to GDPR articles
    const articles = mapViolationsToArticles(violations);
    console.log(`  📋 Identified ${articles.length} relevant GDPR articles: ${articles.join(', ')}`);

    // Query GDPR Hub precedents
    const precedents = await queryPrecedents(articles, jurisdiction);
    console.log(`  📚 Found ${precedents.length} relevant precedents`);

    // Calculate risk range using statistical analysis
    const riskCalculation = calculateRiskRange(precedents, violations, annualRevenue);

    // Determine risk level
    const riskLevel = determineRiskLevel(riskCalculation, violations);

    // Select top cited precedents
    const citedPrecedents = selectTopPrecedents(precedents, 5);

    console.log(`  💰 Risk Assessment: ${riskCalculation.risk_min}€ - ${riskCalculation.risk_max}€ (${riskLevel})`);

    return {
      articles,
      precedents: citedPrecedents,
      totalPrecedentsFound: precedents.length,
      risk_min: riskCalculation.risk_min,
      risk_max: riskCalculation.risk_max,
      risk_median: riskCalculation.risk_median,
      risk_level: riskLevel,
      confidence: calculateConfidence(precedents.length),
      aggravating_factors: riskCalculation.aggravating_factors,
      mitigating_factors: riskCalculation.mitigating_factors,
      revenue_cap: riskCalculation.revenue_cap
    };
  } catch (error) {
    console.error('❌ Risk assessment failed:', error.message);
    throw error;
  }
}

/**
 * Map violations to GDPR articles
 * @param {Object} violations - All violations
 * @returns {Array<string>} GDPR articles
 */
function mapViolationsToArticles(violations) {
  const articles = new Set();

  // noyb violations
  if (violations.bannerViolations && violations.bannerViolations.length > 0) {
    violations.bannerViolations.forEach(v => {
      switch (v.id) {
        case 'type_a':
        case 'type_c':
        case 'type_d':
        case 'type_e':
          articles.add('Art. 7(4)'); // Consent must be freely given
          break;
        case 'type_b':
          articles.add('Art. 4(11)'); // Consent definition
          break;
        case 'type_h':
          articles.add('Art. 6(1)(f)'); // Legitimate interest
          articles.add('Art. 21'); // Right to object
          break;
        case 'type_k':
          articles.add('Art. 7(3)'); // Withdrawal of consent
          break;
      }
    });
  }

  // Tracking before consent
  if (violations.trackingBeforeConsent) {
    articles.add('Art. 5(3)'); // ePrivacy Directive (often cited as Art. 5.3)
    articles.add('Art. 6(1)(a)'); // Lawfulness - consent
  }

  // Privacy Policy violations
  if (violations.privacyPolicyScore && violations.privacyPolicyScore < 60) {
    articles.add('Art. 13'); // Information to be provided (transparency)
    articles.add('Art. 14'); // Information when data not obtained from subject
  }

  // Cookie Policy violations
  if (violations.undeclaredCookies && violations.undeclaredCookies.length > 0) {
    articles.add('Art. 13(1)'); // Transparency obligations
  }

  // Consent Mode violations
  if (violations.consentModeIssues && violations.consentModeIssues.length > 0) {
    articles.add('Art. 7(1)'); // Conditions for consent
  }

  // Add general articles if any violations exist
  if (articles.size > 0) {
    articles.add('Art. 5(1)(a)'); // Lawfulness, fairness and transparency
    articles.add('Art. 12'); // Transparent information
  }

  return Array.from(articles);
}

/**
 * Query GDPR Hub precedents database
 * @param {Array<string>} articles - GDPR articles
 * @param {string} jurisdiction - Jurisdiction
 * @returns {Promise<Array>} Matching precedents
 */
async function queryPrecedents(articles, jurisdiction) {
  try {
    const db = getDatabase();

    // Build SQL query
    // Note: We'll query by relevant_articles LIKE pattern for each article
    const articleConditions = articles.map(() => 'relevant_articles LIKE ?').join(' OR ');

    let query = `
      SELECT *
      FROM gdpr_precedents
      WHERE (${articleConditions})
    `;

    // Add jurisdiction filter (EU includes all, specific country filters by jurisdiction)
    if (jurisdiction !== 'EU') {
      query += ` AND jurisdiction = ?`;
    }

    // Order by fine amount and recent decisions
    query += ` ORDER BY fine_eur DESC, decision_date DESC LIMIT 50`;

    const params = articles.map(art => `%${art}%`);
    if (jurisdiction !== 'EU') {
      params.push(jurisdiction);
    }

    const stmt = db.prepare(query);
    const precedents = stmt.all(...params);

    return precedents.map(p => ({
      case_number: p.case_number,
      dpa: p.dpa,
      jurisdiction: p.jurisdiction,
      decision_date: p.decision_date,
      relevant_articles: p.relevant_articles,
      fine_eur: p.fine_eur,
      sector: p.sector,
      summary: p.summary
    }));
  } catch (error) {
    console.error('Failed to query precedents:', error.message);
    return [];
  }
}

/**
 * Calculate risk range using statistical analysis
 * @param {Array} precedents - Precedents
 * @param {Object} violations - Violations
 * @param {number} annualRevenue - Annual revenue in EUR
 * @returns {Object} Risk calculation
 */
function calculateRiskRange(precedents, violations, annualRevenue) {
  if (precedents.length === 0) {
    // No precedents found - use conservative estimates
    return {
      risk_min: 5000,
      risk_max: 50000,
      risk_median: 20000,
      aggravating_factors: [],
      mitigating_factors: [],
      revenue_cap: null
    };
  }

  // Extract fine amounts
  const fines = precedents.map(p => p.fine_eur).filter(f => f > 0).sort((a, b) => a - b);

  if (fines.length === 0) {
    return {
      risk_min: 5000,
      risk_max: 50000,
      risk_median: 20000,
      aggravating_factors: [],
      mitigating_factors: [],
      revenue_cap: null
    };
  }

  // Calculate percentiles
  const p25 = percentile(fines, 25);
  const p50 = percentile(fines, 50); // Median
  const p75 = percentile(fines, 75);

  // Apply multipliers based on violation severity
  const { multiplier, aggravatingFactors, mitigatingFactors } = calculateMultipliers(violations);

  let risk_min = Math.round(p25 * multiplier.min);
  let risk_max = Math.round(p75 * multiplier.max);
  let risk_median = Math.round(p50 * multiplier.median);

  // Apply revenue cap (4% of annual turnover - but we use 0.5% as conservative estimate)
  let revenue_cap = null;
  if (annualRevenue) {
    revenue_cap = Math.round(annualRevenue * 0.005); // 0.5% conservative estimate
    if (risk_max > revenue_cap) {
      risk_max = revenue_cap;
    }
    if (risk_median > revenue_cap) {
      risk_median = revenue_cap;
    }
  }

  // Ensure minimums
  risk_min = Math.max(risk_min, 1000);
  risk_max = Math.max(risk_max, risk_min * 2);

  return {
    risk_min,
    risk_max,
    risk_median,
    aggravating_factors: aggravatingFactors,
    mitigating_factors: mitigatingFactors,
    revenue_cap
  };
}

/**
 * Calculate percentile
 * @param {Array<number>} sortedArray - Sorted array of numbers
 * @param {number} percentile - Percentile (0-100)
 * @returns {number} Percentile value
 */
function percentile(sortedArray, percentile) {
  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
}

/**
 * Calculate multipliers based on violation severity
 * @param {Object} violations - Violations
 * @returns {Object} Multipliers and factors
 */
function calculateMultipliers(violations) {
  let multiplier = { min: 1.0, max: 1.0, median: 1.0 };
  const aggravatingFactors = [];
  const mitigatingFactors = [];

  // Aggravating factors
  if (violations.trackingBeforeConsent) {
    multiplier.min *= 1.5;
    multiplier.max *= 2.0;
    multiplier.median *= 1.8;
    aggravatingFactors.push('Tracking before consent (clear ePrivacy violation)');
  }

  if (violations.bannerViolations && violations.bannerViolations.some(v => v.severity === 'critical')) {
    const criticalCount = violations.bannerViolations.filter(v => v.severity === 'critical').length;
    multiplier.min *= 1.2;
    multiplier.max *= 1.5;
    multiplier.median *= 1.3;
    aggravatingFactors.push(`${criticalCount} critical consent mechanism violation${criticalCount > 1 ? 's' : ''}`);
  }

  if (violations.undeclaredCookies && violations.undeclaredCookies.length > 10) {
    multiplier.min *= 1.3;
    multiplier.max *= 1.4;
    multiplier.median *= 1.3;
    aggravatingFactors.push(`${violations.undeclaredCookies.length} undeclared cookies (lack of transparency)`);
  }

  if (violations.privacyPolicyScore && violations.privacyPolicyScore < 40) {
    multiplier.min *= 1.2;
    multiplier.max *= 1.3;
    multiplier.median *= 1.2;
    aggravatingFactors.push('Severely inadequate privacy policy');
  }

  // Mitigating factors
  if (violations.privacyPolicyScore && violations.privacyPolicyScore >= 70) {
    multiplier.min *= 0.8;
    multiplier.max *= 0.9;
    multiplier.median *= 0.85;
    mitigatingFactors.push('Good privacy policy demonstrates compliance effort');
  }

  if (violations.consentModeCompliant) {
    multiplier.min *= 0.9;
    multiplier.max *= 0.95;
    multiplier.median *= 0.92;
    mitigatingFactors.push('Google Consent Mode V2 properly implemented');
  }

  if (!violations.trackingBeforeConsent && violations.bannerViolations && violations.bannerViolations.length === 0) {
    multiplier.min *= 0.7;
    multiplier.max *= 0.8;
    multiplier.median *= 0.75;
    mitigatingFactors.push('No technical or consent mechanism violations detected');
  }

  return {
    multiplier,
    aggravatingFactors,
    mitigatingFactors
  };
}

/**
 * Determine risk level
 * @param {Object} riskCalculation - Risk calculation
 * @param {Object} violations - Violations
 * @returns {string} Risk level
 */
function determineRiskLevel(riskCalculation, violations) {
  const maxFine = riskCalculation.risk_max;
  const hasCritical = violations.trackingBeforeConsent ||
                     (violations.bannerViolations && violations.bannerViolations.some(v => v.severity === 'critical'));

  if (hasCritical && maxFine > 50000) {
    return 'Critical';
  } else if (hasCritical || maxFine > 30000) {
    return 'High';
  } else if (maxFine > 10000) {
    return 'Medium';
  } else {
    return 'Low';
  }
}

/**
 * Calculate confidence level based on precedents found
 * @param {number} precedentsCount - Number of precedents
 * @returns {string} Confidence level
 */
function calculateConfidence(precedentsCount) {
  if (precedentsCount >= 10) return 'High';
  if (precedentsCount >= 5) return 'Medium';
  return 'Low';
}

/**
 * Select top precedents to cite
 * @param {Array} precedents - All precedents
 * @param {number} count - Number to select
 * @returns {Array} Top precedents
 */
function selectTopPrecedents(precedents, count) {
  // Sort by relevance: higher fines first, recent dates
  return precedents
    .slice(0, count)
    .map(p => ({
      case_number: p.case_number,
      dpa: p.dpa,
      jurisdiction: p.jurisdiction,
      decision_date: p.decision_date,
      fine_eur: p.fine_eur,
      summary: p.summary
    }));
}

/**
 * Save risk assessment to database
 * @param {Object} db - Database instance
 * @param {number} auditId - Audit ID
 * @param {Object} risk - Risk assessment
 * @param {Object} violations - All violations
 */
function saveRiskAssessment(db, auditId, risk, violations) {
  try {
    const stmt = db.prepare(`
      INSERT INTO risk_assessments (
        audit_id,
        violations_json,
        total_risk_min,
        total_risk_max,
        risk_level
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      auditId,
      JSON.stringify({
        articles: risk.articles,
        aggravating_factors: risk.aggravating_factors,
        mitigating_factors: risk.mitigating_factors,
        cited_precedents: risk.precedents,
        all_violations: violations
      }),
      risk.risk_min,
      risk.risk_max,
      risk.risk_level
    );

    console.log('✅ Risk assessment saved to database');
  } catch (error) {
    console.error('❌ Failed to save risk assessment:', error.message);
    throw error;
  }
}

module.exports = {
  assessRisk,
  mapViolationsToArticles,
  queryPrecedents,
  calculateRiskRange,
  determineRiskLevel,
  saveRiskAssessment
};
