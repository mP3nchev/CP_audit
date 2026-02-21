const fs = require('fs');
const path = require('path');
const constants = require('../config/constants');
const { CircuitBreaker } = require('../utils/circuit-breaker');

/**
 * Claude API Integration with Prompt Caching + Circuit Breaker
 * Cost optimization: 90% reduction on cached prompts
 */

const claudeBreaker = new CircuitBreaker({ name: 'claude-api', failureThreshold: 3, resetTimeout: 120000 });
const CLAUDE_TIMEOUT_MS = 90000;

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
      console.error('❌ Privacy policy prompt file not found at:', promptPath);
      console.error('   Please add the AI INSTRUCTION SET — PRIVACY POLICY AUDITOR.md');
      console.error('   content to: backend/prompts/privacy-policy-auditor-full.txt');
      throw new Error('Privacy policy prompt file not found. See backend/prompts/README.md');
    }

    const prompt = fs.readFileSync(promptPath, 'utf8');
    console.log(`✅ Loaded privacy policy prompt (${(prompt.length / 1024).toFixed(2)} KB)`);

    return prompt;
  } catch (error) {
    console.error('❌ Failed to load privacy policy prompt:', error.message);
    throw error;
  }
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
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🤖 Starting Claude API Privacy Policy Analysis');
    console.log('═══════════════════════════════════════════════════════');

    // Validate API key
    if (!constants.CLAUDE_API_KEY || constants.CLAUDE_API_KEY === 'sk-ant-api03-placeholder') {
      throw new Error('Claude API key not configured. Please set CLAUDE_API_KEY in .env');
    }

    // Load the full prompt
    const fullPrompt = loadPrivacyPolicyPrompt();

    // Prepare the request
    const requestBody = {
      model: constants.CLAUDE_MODEL,
      max_tokens: 4096,
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

    console.log(`📤 Sending request to Claude API...`);
    console.log(`   Model: ${constants.CLAUDE_MODEL}`);
    console.log(`   Prompt size: ${(fullPrompt.length / 1024).toFixed(2)} KB`);
    console.log(`   Policy size: ${(policyText.length / 1024).toFixed(2)} KB`);

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
      console.error('❌ Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Log usage and cost
    const usage = data.usage || {};
    const cost = calculateCost(usage);

    console.log('');
    console.log('📊 API Usage:');
    console.log(`   Input tokens: ${usage.input_tokens || 0}`);
    console.log(`   Output tokens: ${usage.output_tokens || 0}`);
    console.log(`   Cached tokens: ${usage.cache_read_input_tokens || 0}`);
    console.log(`   Cache creation tokens: ${usage.cache_creation_input_tokens || 0}`);
    console.log(`   Cost: $${cost.toFixed(4)}`);
    console.log(`   Cached: ${usage.cache_read_input_tokens ? 'YES ✅' : 'NO (first request)'}`);

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
      console.error('❌ Failed to parse Claude response as JSON');
      console.error('Response:', responseText.substring(0, 500));
      throw new Error('Failed to parse Claude response as JSON');
    }

    // Validate response structure
    if (!analysis.criteria || !Array.isArray(analysis.criteria)) {
      throw new Error('Invalid analysis format: missing criteria array');
    }

    if (analysis.criteria.length !== 37) {
      console.warn(`⚠️  Expected 37 criteria, got ${analysis.criteria.length}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('');
    console.log('✅ Analysis complete');
    console.log(`   Criteria analyzed: ${analysis.criteria.length}`);
    console.log(`   Total score: ${analysis.total_score}/${analysis.max_score}`);
    console.log(`   Percentage: ${analysis.percentage?.toFixed(1)}%`);
    console.log(`   Category: ${analysis.category}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

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
    console.error('');
    console.error('═══════════════════════════════════════════════════════');
    console.error('❌ Privacy policy analysis failed');
    console.error(`   Error: ${error.message}`);
    console.error(`   Duration: ${duration}s`);
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
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
    console.log('🧪 Testing Claude API connection...');

    if (!constants.CLAUDE_API_KEY || constants.CLAUDE_API_KEY === 'sk-ant-api03-placeholder') {
      console.log('⚠️  Claude API key not configured');
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
      console.log('✅ Claude API connection successful');
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ Claude API connection failed: ${response.status} - ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Claude API connection failed:', error.message);
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
  analyzePrivacyPolicy,
  testClaudeConnection,
  calculateCost,
  buildFallbackAnalysis,
  claudeBreaker
};
