const { analyzePrivacyPolicy, buildFallbackAnalysis } = require('../integrations/claude-api');
const { extractTextFromBuffer, getFileType, cleanText } = require('../utils/text-extractor');
const { getDatabase } = require('../database/db');
const { validateSchema } = require('../utils/schema-validator');
const { createLogger } = require('../utils/logger');

const logger = createLogger('policy-analyzer');

/**
 * Privacy Policy Analyzer
 * Analyzes privacy policies against 37 GDPR criteria using Claude API
 */

/**
 * Analyze privacy policy from uploaded file
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} filename - Original filename
 * @param {number} auditId - Audit database ID
 * @param {string} policyType - Policy type ('privacy' or 'cookie')
 * @returns {Promise<Object>} Analysis results
 */
async function analyzePolicyFile(fileBuffer, filename, auditId, policyType = 'privacy') {
  const startTime = Date.now();

  try {
    logger.info('policy-analysis-start', {
      auditId,
      policyType,
      filename,
      fileType: getFileType(filename)
    });

    // Step 1: Extract text from file
    logger.info('policy-text-extraction-start', { auditId, fileType: getFileType(filename) });
    const rawText = await extractTextFromBuffer(fileBuffer, filename);

    // Step 2: Clean text
    logger.info('policy-text-cleaning', { auditId });
    const policyText = cleanText(rawText);

    logger.info('policy-text-extracted', { auditId, charCount: policyText.length });

    // Check minimum length
    if (policyText.length < 500) {
      throw new Error('Policy text too short. Minimum 500 characters required.');
    }

    // Check maximum length (Claude limit is ~200k tokens ≈ 800k characters)
    if (policyText.length > 500000) {
      logger.warn('policy-text-truncated', { auditId, original: policyText.length, truncated: 500000 });
      policyText = policyText.substring(0, 500000);
    }

    // Step 3: Analyze with Claude API (with circuit breaker fallback)
    logger.info('policy-api-analysis-start', { auditId });
    let result;
    try {
      result = await analyzePrivacyPolicy(policyText);
    } catch (err) {
      if (err.code === 'CIRCUIT_OPEN' || err.code === 'CLAUDE_TIMEOUT') {
        logger.warn('policy-api-fallback', { auditId, reason: err.code });
        result = buildFallbackAnalysis();
      } else {
        throw err;
      }
    }

    // Step 4: Save to database
    logger.info('policy-db-save-start', { auditId });
    await savePolicyAnalysis(auditId, policyType, result.analysis, policyText, result.usage, result.duration);

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('policy-analysis-complete', {
      auditId,
      durationSeconds: totalDuration,
      apiCost: result.usage.cost_usd.toFixed(4),
      score: result.analysis.total_score,
      maxScore: result.analysis.max_score,
      percentage: result.analysis.percentage?.toFixed(1),
      category: result.analysis.category
    });

    return {
      success: true,
      analysis: result.analysis,
      usage: result.usage,
      duration: parseFloat(totalDuration),
      file: {
        name: filename,
        type: getFileType(filename),
        size: fileBuffer.length,
        text_length: policyText.length
      }
    };

  } catch (error) {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.error('policy-analysis-failed', {
      error: '❌ ' + error.message,
      auditId,
      durationSeconds: totalDuration,
      stack: error.stack
    });

    throw error;
  }
}

/**
 * Save policy analysis results to database
 * @param {number} auditId - Audit ID
 * @param {string} policyType - Policy type
 * @param {Object} analysis - Analysis results
 * @param {string} policyText - Policy text
 * @param {Object} usage - API usage stats
 * @param {number} duration - Analysis duration in seconds
 */
async function savePolicyAnalysis(auditId, policyType, analysis, policyText, usage, duration) {
  const db = getDatabase();

  try {
    // Validate analysis structure before writing to DB
    validateSchema('policyAnalysis', {
      criteria: analysis.criteria,
      total_score: analysis.total_score,
      max_score: analysis.max_score,
      percentage: analysis.percentage,
      category: analysis.category
    });

    // Save policy analysis
    const stmt = db.prepare(`
      INSERT INTO policy_analysis (
        audit_id,
        policy_type,
        criteria_scores_json,
        total_score,
        percentage,
        category,
        top_recommendations_json,
        policy_text,
        analysis_duration_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      auditId,
      policyType,
      JSON.stringify(analysis.criteria || []),
      analysis.total_score || 0,
      analysis.percentage || 0,
      analysis.category || 'Unknown',
      JSON.stringify(analysis.top_recommendations || []),
      policyText.substring(0, 100000), // Store first 100k characters
      Math.round(duration)
    );

    logger.info('policy-analysis-saved', { auditId, policyType });

    // Check for cost alerts
    if (usage.cost_usd > 0.20) {
      logger.warn('policy-cost-high', { auditId, cost: usage.cost_usd.toFixed(4), threshold: 0.20 });
    }

    if (usage.cached_tokens === 0 && usage.cache_creation_tokens === 0) {
      logger.warn('policy-no-caching', { auditId, message: 'No prompt caching detected' });
    }

  } catch (error) {
    logger.error('policy-save-failed', { error: '❌ ' + error.message, auditId });
    throw error;
  }
}

/**
 * Get policy analysis results from database
 * @param {number} auditId - Audit ID
 * @param {string} policyType - Policy type
 * @returns {Object} Analysis results or null
 */
function getPolicyAnalysis(auditId, policyType) {
  const db = getDatabase();

  try {
    const analysis = db.prepare(`
      SELECT * FROM policy_analysis
      WHERE audit_id = ? AND policy_type = ?
    `).get(auditId, policyType);

    if (!analysis) {
      return null;
    }

    return {
      ...analysis,
      criteria_scores: JSON.parse(analysis.criteria_scores_json || '[]'),
      top_recommendations: JSON.parse(analysis.top_recommendations_json || '[]')
    };
  } catch (error) {
    logger.error('policy-get-failed', { error: '❌ ' + error.message, auditId });
    return null;
  }
}

/**
 * Calculate overall privacy policy score
 * Based on 37 criteria with tier-based weighting
 * @param {Array} criteria - Array of criteria scores
 * @returns {Object} Score summary
 */
function calculatePolicyScore(criteria) {
  if (!criteria || criteria.length === 0) {
    return {
      total_score: 0,
      max_score: 0,
      percentage: 0,
      category: 'Unknown'
    };
  }

  let totalScore = 0;
  let maxScore = 0;

  criteria.forEach(criterion => {
    const weight = criterion.weight || 1;
    totalScore += (criterion.score || 0) * weight;
    maxScore += 5 * weight; // Max score is 5 per criterion
  });

  const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

  // Categorize score
  let category;
  if (percentage >= 90) {
    category = 'Excellent';
  } else if (percentage >= 75) {
    category = 'Good';
  } else if (percentage >= 60) {
    category = 'Fair';
  } else if (percentage >= 40) {
    category = 'Poor';
  } else {
    category = 'Critical';
  }

  return {
    total_score: Math.round(totalScore),
    max_score: maxScore,
    percentage: parseFloat(percentage.toFixed(2)),
    category
  };
}

module.exports = {
  analyzePolicyFile,
  getPolicyAnalysis,
  calculatePolicyScore
};
