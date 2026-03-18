const fs = require('fs');
const path = require('path');
const constants = require('../config/constants');
const { CircuitBreaker } = require('../utils/circuit-breaker');
const { createLogger } = require('../utils/logger');

/**
 * Claude API Integration with Prompt Caching + Circuit Breaker
 * Cost optimization: 90% reduction on cached prompts
 */

const logger = createLogger('claude-api');
const claudeBreaker = new CircuitBreaker({ name: 'claude-api', failureThreshold: 3, resetTimeout: 120000 });
const CLAUDE_TIMEOUT_MS = 90000;

/**
 * Budget Tracker with SQLite Persistence
 * Survives server restarts (critical for production auto-scaling)
 */
let dailySpent = 0;
let budgetResetTime = Date.now();
let db = null; // Lazy-loaded database connection

/**
 * Get database connection (lazy initialization)
 */
function getDb() {
  if (!db) {
    const { getDatabase } = require('../database/db');
    db = getDatabase();
  }
  return db;
}

/**
 * Load budget from database on first access
 */
function loadBudgetFromDb() {
  try {
    const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    const row = getDb().prepare('SELECT spent_usd, reset_at FROM budget_tracking WHERE date = ?').get(today);

    if (row) {
      dailySpent = row.spent_usd;
      budgetResetTime = new Date(row.reset_at).getTime();
      logger.info('budget-loaded', { date: today, spent: dailySpent.toFixed(4) });
    } else {
      // First request of the day - initialize new row
      dailySpent = 0;
      budgetResetTime = Date.now();
      getDb().prepare('INSERT OR IGNORE INTO budget_tracking (date, spent_usd) VALUES (?, 0)').run(today);
      logger.info('budget-initialized', { date: today });
    }
  } catch (error) {
    logger.error('budget-load-failed', { error: error.message });
    // Fallback to in-memory tracking
    dailySpent = 0;
    budgetResetTime = Date.now();
  }
}

/**
 * Save budget to database
 * @param {number} cost - Cost to add
 */
function saveBudgetToDb(cost) {
  try {
    const today = new Date().toISOString().split('T')[0];
    getDb().prepare(`
      INSERT INTO budget_tracking (date, spent_usd, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date) DO UPDATE SET
        spent_usd = spent_usd + excluded.spent_usd,
        updated_at = CURRENT_TIMESTAMP
    `).run(today, cost);
  } catch (error) {
    logger.error('budget-save-failed', { error: error.message, cost });
  }
}

/**
 * Check if budget allows a new audit request
 * @returns {{ allowed: boolean, spent: number, limit: number, retryAfter?: number }}
 */
function checkBudget() {
  // Lazy load budget on first check
  if (dailySpent === 0 && budgetResetTime === Date.now()) {
    loadBudgetFromDb();
  }
  const budget = constants.DAILY_BUDGET_USD;

  if (dailySpent >= budget) {
    // Budget exceeded - calculate seconds until next day (simplified: 24h from first spend)
    const retryAfter = Math.max(0, Math.ceil((budgetResetTime + 86400000 - Date.now()) / 1000));
    return {
      allowed: false,
      spent: dailySpent,
      limit: budget,
      retryAfter
    };
  }

  return {
    allowed: true,
    spent: dailySpent,
    limit: budget
  };
}

/**
 * Track spending after Claude API call
 * @param {number} cost - Cost in USD
 */
function trackSpending(cost) {
  dailySpent += cost;
  saveBudgetToDb(cost); // Persist to database
  logger.info('api-cost-tracked', {
    cost: cost.toFixed(4),
    dailyTotal: dailySpent.toFixed(4),
    budget: constants.DAILY_BUDGET_USD,
    remaining: (constants.DAILY_BUDGET_USD - dailySpent).toFixed(4)
  });
}

/**
 * Reset budget counter (called manually or via cron)
 */
function resetBudget() {
  const previousSpent = dailySpent;
  dailySpent = 0;
  budgetResetTime = Date.now();

  // Clear database for new day
  try {
    const today = new Date().toISOString().split('T')[0];
    getDb().prepare('INSERT OR REPLACE INTO budget_tracking (date, spent_usd, reset_at) VALUES (?, 0, CURRENT_TIMESTAMP)').run(today);
    logger.info('budget-reset', { previousSpent: previousSpent.toFixed(4), date: today });
  } catch (error) {
    logger.error('budget-reset-failed', { error: error.message });
  }
}

/**
 * Fetch with AbortController timeout
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Claude API timeout after ${timeoutMs}ms`);
      e.code = 'CLAUDE_TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the privacy policy auditor prompt
 * @returns {string} Full prompt text
 */
function loadPrivacyPolicyPrompt() {
  try {
    const promptPath = path.join(__dirname, '../../prompts/privacy-policy-auditor-full.txt');

    if (!fs.existsSync(promptPath)) {
      logger.error('prompt-not-found', { path: promptPath });
      throw new Error('Privacy policy prompt file not found. See backend/prompts/README.md');
    }

    const prompt = fs.readFileSync(promptPath, 'utf8');
    logger.info('prompt-loaded', { sizeKB: (prompt.length / 1024).toFixed(2) });

    return prompt;
  } catch (error) {
    logger.error('prompt-load-failed', { error: error.message });
    throw error;
  }
}

/**
 * Generic Claude API call — used by solution-generator, cookie-policy-comparator, etc.
 *
 * @param {string} prompt - User prompt text
 * @param {Object} options
 * @param {number} [options.maxTokens]   - Max output tokens (default: CLAUDE_MAX_TOKENS)
 * @param {number} [options.temperature] - Sampling temperature (0–1, default: 0.3)
 * @param {boolean} [options.useCache]   - Enable prompt caching (default: false)
 * @returns {Promise<{ text: string, usage: Object }>}
 */
async function analyzeWithClaude(prompt, options = {}) {
  const maxTokens = options.maxTokens || constants.CLAUDE_MAX_TOKENS;
  const temperature = options.temperature !== undefined ? options.temperature : 0.3;
  const startTime = Date.now();

  if (!constants.CLAUDE_API_KEY || constants.CLAUDE_API_KEY === 'sk-ant-api03-placeholder') {
    throw new Error('Claude API key not configured. Please set CLAUDE_API_KEY in .env');
  }

  const messageContent = options.useCache
    ? [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }]
    : prompt;

  const requestBody = {
    model: constants.CLAUDE_MODEL,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: messageContent }]
  };

  const response = await claudeBreaker.call(() =>
    fetchWithTimeout(constants.CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': constants.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }, CLAUDE_TIMEOUT_MS)
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('api-request-failed', { status: response.status, error: errorText.substring(0, 200) });
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const usage = data.usage || {};
  const cost = calculateCost(usage);

  trackSpending(cost);

  logger.info('api-usage', {
    maxTokens,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cost: cost.toFixed(4),
    durationMs: Date.now() - startTime
  });

  const text = data.content?.[0]?.text;
  if (!text) {
    throw new Error('No response text from Claude API');
  }

  return {
    text,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cached_tokens: usage.cache_read_input_tokens || 0,
      cost_usd: cost,
      model: constants.CLAUDE_MODEL
    }
  };
}

/**
 * Analyze privacy policy using Claude API
 * @param {string} policyText - Privacy policy text to analyze
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Analysis results
 */
async function analyzePrivacyPolicy(policyText, options = {}) {
  const startTime = Date.now();

  try {
    logger.info('analysis-start', {
      model: constants.CLAUDE_MODEL,
      policySizeKB: (policyText.length / 1024).toFixed(2)
    });

    // Validate API key
    if (!constants.CLAUDE_API_KEY || constants.CLAUDE_API_KEY === 'sk-ant-api03-placeholder') {
      throw new Error('Claude API key not configured. Please set CLAUDE_API_KEY in .env');
    }

    // Load the full prompt
    const fullPrompt = loadPrivacyPolicyPrompt();

    // Prepare the request
    const requestBody = {
      model: constants.CLAUDE_MODEL,
      max_tokens: constants.CLAUDE_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: fullPrompt,
          cache_control: { type: 'ephemeral' } // ENABLE PROMPT CACHING
        }
      ],
      messages: [
        {
          role: 'user',
          content: `Analyze the following privacy policy and return a JSON response with all 37 criteria scored:\n\n${policyText}`
        }
      ]
    };

    logger.info('api-request-sent', {
      promptSizeKB: (fullPrompt.length / 1024).toFixed(2),
      policySizeKB: (policyText.length / 1024).toFixed(2)
    });

    // Make API request with circuit breaker + AbortController timeout
    const response = await claudeBreaker.call(() =>
      fetchWithTimeout(constants.CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': constants.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }, CLAUDE_TIMEOUT_MS)
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('api-request-failed', { status: response.status, error: errorText.substring(0, 200) });
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Log usage and cost
    const usage = data.usage || {};
    const cost = calculateCost(usage);

    logger.info('api-usage', {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cachedTokens: usage.cache_read_input_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cost: cost.toFixed(4),
      cached: !!usage.cache_read_input_tokens
    });

    // Track spending for budget control
    trackSpending(cost);

    // Extract response text
    const responseText = data.content?.[0]?.text;

    if (!responseText) {
      throw new Error('No response text from Claude API');
    }

    // Parse JSON response
    let analysis;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                       responseText.match(/```\n([\s\S]*?)\n```/);

      const jsonText = jsonMatch ? jsonMatch[1] : responseText;
      analysis = JSON.parse(jsonText);
    } catch (parseError) {
      logger.error('json-parse-failed', { responsePreview: responseText.substring(0, 200) });
      throw new Error('Failed to parse Claude response as JSON');
    }

    // Validate response structure
    if (!analysis.criteria || !Array.isArray(analysis.criteria)) {
      throw new Error('Invalid analysis format: missing criteria array');
    }

    if (analysis.criteria.length !== 37) {
      logger.warn('criteria-count-mismatch', { expected: 37, actual: analysis.criteria.length });
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('analysis-complete', {
      criteriaCount: analysis.criteria.length,
      totalScore: analysis.total_score,
      maxScore: analysis.max_score,
      percentage: analysis.percentage?.toFixed(1),
      category: analysis.category,
      durationSeconds: duration
    });

    return {
      analysis,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cached_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_usd: cost,
        model: constants.CLAUDE_MODEL
      },
      duration: parseFloat(duration)
    };

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.error('analysis-failed', {
      error: error.message,
      code: error.code,
      durationSeconds: duration
    });
    throw error;
  }
}

/**
 * Calculate API cost based on usage
 * Pricing for Claude Sonnet 4 (as of Jan 2025):
 * - Input: $3 per million tokens
 * - Output: $15 per million tokens
 * - Cache writes: $3.75 per million tokens
 * - Cache reads: $0.30 per million tokens
 *
 * @param {Object} usage - Usage object from Claude API
 * @returns {number} Cost in USD
 */
function calculateCost(usage) {
  const inputCost = (usage.input_tokens || 0) * 0.000003;
  const outputCost = (usage.output_tokens || 0) * 0.000015;
  const cacheWriteCost = (usage.cache_creation_input_tokens || 0) * 0.00000375;
  const cacheReadCost = (usage.cache_read_input_tokens || 0) * 0.0000003;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * Test Claude API connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testClaudeConnection() {
  try {
    logger.info('connection-test-start', {});

    if (!constants.CLAUDE_API_KEY || constants.CLAUDE_API_KEY === 'sk-ant-api03-placeholder') {
      logger.warn('connection-test-no-key', {});
      return false;
    }

    const response = await fetch(constants.CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': constants.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: constants.CLAUDE_MODEL,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      })
    });

    if (response.ok) {
      logger.info('connection-test-success', {});
      return true;
    } else {
      const errorText = await response.text();
      logger.error('connection-test-failed', { status: response.status, error: errorText.substring(0, 200) });
      return false;
    }
  } catch (error) {
    logger.error('connection-test-error', { error: error.message });
    return false;
  }
}

/**
 * Graceful fallback when Claude is unavailable.
 * Returns a placeholder requiring manual review.
 */
function buildFallbackAnalysis() {
  return {
    analysis: {
      criteria: Array.from({ length: 37 }, (_, i) => ({
        id: i + 1, score: 0, max_score: 1,
        reason: 'AI analysis unavailable — manual review required.',
        skipped: true
      })),
      total_score: 0, max_score: 37, percentage: 0,
      category: 'MANUAL_REVIEW_REQUIRED',
      fallback: true, fallback_reason: 'Claude API circuit breaker open or timeout'
    },
    usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
    duration: 0,
    fallback: true
  };
}

module.exports = {
  analyzeWithClaude,
  analyzePrivacyPolicy,
  testClaudeConnection,
  calculateCost,
  buildFallbackAnalysis,
  claudeBreaker,
  checkBudget,
  resetBudget
};
