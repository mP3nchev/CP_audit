/**
 * Consent Simulation v1.0 - Human-Assisted Browser Session
 *
 * Production-grade module for observing real runtime behavior after Reject vs Accept.
 * NO auto clicks. NO headless consent testing.
 *
 * Execution model:
 * - ONE browser instance (headless: false)
 * - TWO incognito contexts (Reject, Accept)
 * - CLI pause for human interaction
 * - State capture: Cookies (Storage + Network), Network requests, localStorage
 * - Diff comparison
 */

const { launchBrowser, createPage, closeBrowser } = require('./puppeteer-setup');
const { extractCookies } = require('./cookie-extractor');
const { analyzeCookieBanner } = require('../analyzers/cookie-banner-checker');
const readline = require('readline');
const constants = require('../config/constants');
const { getDatabase } = require('../database/db');
const { createLogger } = require('../utils/logger');

const logger = createLogger('consent-simulator-v1');

/**
 * Tracking domains for network filtering (v1)
 */
const TRACKING_DOMAINS = [
  'google-analytics.com',
  'doubleclick.net',
  'facebook.com',
  'connect.facebook.net'
];

/**
 * Wait for human action with CLI pause
 * @param {string} scenarioType - 'reject' or 'accept'
 * @returns {Promise<void>}
 */
async function waitForHumanAction(scenarioType) {
  const actionText = scenarioType === 'reject' ? 'REJECT' : 'ACCEPT';

  logger.debug('separator', { line: '═'.repeat(70) });
  logger.debug('consent-sim-v1-progress', { message: `🎯 HUMAN ACTION REQUIRED - ${scenarioType.toUpperCase()} SCENARIO` });
  logger.debug('separator', { line: '═'.repeat(70) });

  logger.debug('consent-sim-v1-progress', { message: `  1. Locate the consent banner on the page` });
  logger.debug('consent-sim-v1-progress', { message: `  2. Click the "${actionText}" button` });
  logger.debug('consent-sim-v1-progress', { message: `  3. Wait 5 seconds for the page to settle` });
  logger.debug('consent-sim-v1-progress', { message: `  4. Press ENTER in this terminal to continue` });

  logger.debug('separator', { line: '═'.repeat(70) });

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Press ENTER after completing the above steps... ', () => {
      rl.close();
      logger.debug('consent-sim-v1-progress', { message: '✅ Continuing with state capture...\n' });
      resolve();
    });
  });
}

/**
 * Setup network request listener for tracking detection
 * @param {Page} page - Puppeteer page
 * @returns {Array} Array to collect network requests
 */
function setupNetworkListener(page) {
  const networkRequests = [];
  const startTime = Date.now();

  page.on('request', (request) => {
    const url = request.url();
    const hostname = new URL(url).hostname;

    // Filter only tracking requests
    const isTracking = TRACKING_DOMAINS.some(domain => hostname.includes(domain));

    if (isTracking) {
      networkRequests.push({
        hostname: hostname,
        url: url,
        initiatorType: request.resourceType(),
        timestamp: Date.now() - startTime, // Relative to page load
        method: request.method()
      });
    }
  });

  return networkRequests;
}

/**
 * Capture full state after consent interaction
 * @param {Page} page - Puppeteer page
 * @param {Array} networkRequests - Collected network requests
 * @returns {Promise<Object>} Captured state
 */
async function captureState(page, networkRequests) {
  logger.debug('consent-sim-v1-progress', { message: '   📸 Capturing state...' });

  // 1. Extract cookies (triple-source: Storage + Network + document.cookie)
  const cookies = await extractCookies(page, { skipDelay: false, delay: 3000 });

  // 2. Extract localStorage
  const localStorage = await page.evaluate(() => {
    const storage = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      storage[key] = window.localStorage.getItem(key);
    }
    return storage;
  });

  // 3. Network requests (already collected via listener)
  const trackingRequests = networkRequests.filter(req =>
    req.timestamp > 0 // Only requests after page load
  );

  // 4. Capture screenshot AFTER consent interaction (for evidence)
  let screenshot = null;
  try {
    screenshot = await page.screenshot({ fullPage: false, type: 'png' });
    logger.debug('consent-sim-v1-progress', { message: `   📸 Screenshot captured (${screenshot.length} bytes)` });

    // Save to /tmp for evidence
    const fs = require('fs');
    const timestamp = Date.now();
    const screenshotPath = `/tmp/consent-${timestamp}.png`;
    fs.writeFileSync(screenshotPath, screenshot);
    logger.debug('consent-sim-v1-progress', { message: `   💾 Saved: ${screenshotPath}` });
  } catch (e) {
    logger.warn('screenshot-capture-failed', {
      error: '⚠️ ' + e.message,
      scenario
    });
  }

  logger.debug('consent-sim-v1-progress', { message: `   ✅ Captured: ${cookies.length} cookies, ${trackingRequests.length} tracking requests, ${Object.keys(localStorage).length} localStorage items` });

  return {
    cookies: cookies,
    localStorage: localStorage,
    networkRequests: trackingRequests,
    screenshot: screenshot  // NEW field
  };
}

/**
 * Deduplicate cookies by name + domain + path
 * CRITICAL: Prevents false positives from multi-domain cookies
 * @param {Array} cookies - Array of cookie objects
 * @returns {Array} Deduplicated cookies
 */
function dedupeCookies(cookies) {
  const cookieMap = new Map();

  cookies.forEach(cookie => {
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (!cookieMap.has(key)) {
      cookieMap.set(key, cookie);
    }
  });

  return Array.from(cookieMap.values());
}

/**
 * Compare two states and generate diff
 * @param {Object} rejectState - State after reject
 * @param {Object} acceptState - State after accept
 * @returns {Object} Diff comparison
 */
function compareStates(rejectState, acceptState) {

  logger.debug('consent-sim-v1-progress', { message: '🔍 === DIFF COMPARISON ===' });

  // Dedupe cookies BEFORE comparison
  const rejectCookies = dedupeCookies(rejectState.cookies);
  const acceptCookies = dedupeCookies(acceptState.cookies);

  // Cookie diff (by name + domain + path)
  const rejectCookieKeys = new Set(
    rejectCookies.map(c => `${c.name}|${c.domain}|${c.path}`)
  );
  const acceptCookieKeys = new Set(
    acceptCookies.map(c => `${c.name}|${c.domain}|${c.path}`)
  );

  const newCookiesAfterAccept = acceptCookies.filter(c =>
    !rejectCookieKeys.has(`${c.name}|${c.domain}|${c.path}`)
  );

  // Network diff
  const rejectDomains = new Set(rejectState.networkRequests.map(r => r.hostname));
  const acceptDomains = new Set(acceptState.networkRequests.map(r => r.hostname));

  const newDomainsAfterAccept = [...acceptDomains].filter(d => !rejectDomains.has(d));

  // localStorage diff
  const rejectKeys = new Set(Object.keys(rejectState.localStorage));
  const acceptKeys = new Set(Object.keys(acceptState.localStorage));

  const newStorageAfterAccept = [...acceptKeys].filter(k => !rejectKeys.has(k));

  // Log summary
  logger.debug('consent-sim-v1-progress', { message: `   🍪 Reject cookies: ${rejectCookies.length}` });
  logger.debug('consent-sim-v1-progress', { message: `   🍪 Accept cookies: ${acceptCookies.length}` });
  logger.debug('consent-sim-v1-progress', { message: `   ✨ NEW cookies after Accept: ${newCookiesAfterAccept.length}` });

  logger.debug('consent-sim-v1-progress', { message: `   📡 Reject tracking requests: ${rejectState.networkRequests.length}` });
  logger.debug('consent-sim-v1-progress', { message: `   📡 Accept tracking requests: ${acceptState.networkRequests.length}` });
  logger.debug('consent-sim-v1-progress', { message: `   ✨ NEW tracking domains after Accept: ${newDomainsAfterAccept.length}` });

  logger.debug('consent-sim-v1-progress', { message: `   💾 localStorage changes: ${newStorageAfterAccept.length} new keys` });

  return {
    cookies: {
      reject: rejectCookies,
      accept: acceptCookies,
      newAfterAccept: newCookiesAfterAccept
    },
    network: {
      reject: rejectState.networkRequests,
      accept: acceptState.networkRequests,
      newDomainsAfterAccept: newDomainsAfterAccept,
      rejectCount: rejectState.networkRequests.length,
      acceptCount: acceptState.networkRequests.length
    },
    localStorage: {
      reject: rejectState.localStorage,
      accept: acceptState.localStorage,
      newKeysAfterAccept: newStorageAfterAccept
    }
  };
}

/**
 * Run single scenario (Reject or Accept) in incognito context
 * @param {Browser} browser - Puppeteer browser
 * @param {string} websiteUrl - URL to test
 * @param {string} scenarioType - 'reject' or 'accept'
 * @returns {Promise<Object>} Scenario state
 */
async function runScenario(browser, websiteUrl, scenarioType) {

  logger.debug('consent-sim-v1-progress', { message: `${scenarioType === 'reject' ? '🚫' : '✅'} === ${scenarioType.toUpperCase()} SCENARIO ===` });
  logger.debug('consent-sim-v1-progress', { message: `   Testing: ${websiteUrl}` });

  // Create incognito context (isolated cookies/storage)
  const context = await (browser.createBrowserContext || browser.createIncognitoBrowserContext).call(browser);
  const page = await context.newPage();

  // Setup network listener BEFORE navigation
  const networkRequests = setupNetworkListener(page);

  try {
    // Navigate to URL
    logger.debug('consent-sim-v1-progress', { message: '   🌐 Navigating to page...' });
    await page.goto(websiteUrl, {
      waitUntil: 'load',
      timeout: 30000
    });

    // Validate navigation
    const currentUrl = page.url();
    if (currentUrl === 'about:blank') {
      throw new Error('Navigation failed - page is about:blank');
    }

    logger.debug('consent-sim-v1-progress', { message: '   ✅ Page loaded successfully' });

    // 🎯 NEW: Analyze cookie banner for noyb violations BEFORE user interaction
    // This happens while banner is visible in headful browser

    logger.debug('consent-sim-v1-progress', { message: '   🔍 Analyzing cookie banner for noyb compliance...' });
    let bannerAnalysis = null;
    try {
      bannerAnalysis = await analyzeCookieBanner(page, null, null);
      const passedChecks = bannerAnalysis.totalChecks - bannerAnalysis.skippedCount;
      logger.debug('consent-sim-v1-progress', { message: `   ✅ Banner analysis complete: ${bannerAnalysis.passedCount}/${passedChecks} checks passed (${bannerAnalysis.compliancePercentage}%)` });
      if (bannerAnalysis.violationCount > 0) {
        logger.debug('consent-sim-v1-progress', { message: `   ⚠️  Found ${bannerAnalysis.violationCount} violation(s)` });
      }
      if (bannerAnalysis.skippedCount > 0) {
        logger.debug('consent-sim-v1-progress', { message: `   ⏭️  Skipped ${bannerAnalysis.skippedCount} check(s)` });
      }
    } catch (error) {
      logger.warn('banner-analysis-failed', {
        error: '⚠️ ' + error.message,
        scenario
      });
      bannerAnalysis = {
        error: error.message,
        skipped: true
      };
    }

    // Wait for human action
    await waitForHumanAction(scenarioType);

    // Capture state after human interaction
    const state = await captureState(page, networkRequests);

    // Close context
    await context.close();

    return {
      success: true,
      state: state,
      bannerAnalysis: bannerAnalysis  // noyb compliance check results
    };

  } catch (error) {
    logger.error('scenario-execution-failed', {
      error: '❌ ' + error.message,
      scenarioType,
      websiteUrl,
      stack: error.stack
    });
    await context.close().catch(() => {});
    throw error;
  }
}

/**
 * Check if manual consent data has been uploaded for this audit
 * @param {string} auditId - Audit ID
 * @param {string} websiteUrl - Website URL
 * @returns {Promise<Object|null>} Consent data or null
 */
async function checkForManualConsentData(auditId, websiteUrl) {
  if (!auditId) return null;

  try {
    const db = getDatabase();
    const result = db.prepare(`
      SELECT consent_simulation_json, created_at
      FROM scan_results
      WHERE audit_id = ? AND consent_simulation_json IS NOT NULL
      LIMIT 1
    `).get(auditId);

    if (result && result.consent_simulation_json) {
      const rawData = JSON.parse(result.consent_simulation_json);

      // Transform data from upload format to expected format
      // Upload format: { reject: {...}, accept: {...}, comparison: {...} }
      // Expected format: { skipped: false, rejectScenario: {...}, acceptScenario: {...}, comparison: {...} }
      const transformed = {
        skipped: false,
        rejectScenario: {
          success: true,
          cookies: rawData.reject?.cookiesAfterConsent || 0,
          networkRequests: 0,  // Not tracked in upload
          localStorageKeys: 0
        },
        acceptScenario: rawData.accept ? {
          success: true,
          cookies: rawData.accept?.cookiesAfterConsent || 0,
          networkRequests: 0,
          localStorageKeys: 0
        } : {
          success: false,
          cookies: 0,
          networkRequests: 0,
          localStorageKeys: 0
        },
        comparison: rawData.comparison || null,
        duration: 0,  // Not tracked in upload
        uploadedManually: true
      };

      return {
        consentSimulation: transformed,
        uploadedAt: result.created_at
      };
    }

    return null;
  } catch (error) {
    logger.error('manual-consent-check-failed', {
      error: '❌ ' + error.message,
      auditId,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Run human-assisted consent simulation (CANONICAL v1.0)
 * @param {string} websiteUrl - URL to test
 * @param {string} auditId - Optional audit ID for Railway integration
 * @returns {Promise<Object>} Simulation results
 */
async function runAssistedConsentSimulation(websiteUrl, auditId = null) {
  const startTime = Date.now();

  logger.debug('consent-sim-v1-progress', { message: `[DEBUG] Consent simulation starting...` });
  logger.debug('consent-sim-v1-progress', { message: `[DEBUG] IS_RAILWAY: ${constants.IS_RAILWAY}` });
  logger.debug('consent-sim-v1-progress', { message: `[DEBUG] CONSENT_MODE: ${constants.CONSENT_MODE}` });
  logger.debug('consent-sim-v1-progress', { message: `[DEBUG] RAILWAY_ENVIRONMENT: ${process.env.RAILWAY_ENVIRONMENT}` });
  logger.debug('consent-sim-v1-progress', { message: `[DEBUG] auditId: ${auditId}` });

  // Check if running on Railway (no GUI available)
  if (constants.IS_RAILWAY && constants.CONSENT_MODE === 'assisted') {
    logger.debug('consent-sim-v1-progress', { message: `[DEBUG] Entered Railway block - ALWAYS pausing for manual upload...` });

    // IMPORTANT: Always pause on first run during audit scan
    // Data will be loaded when audit is resumed via continueAuditFromStep17()
    // This prevents re-using old data from previous audits
    const railwayUrl = process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'https://cpaudit-production.up.railway.app';

    logger.debug('consent-sim-v1-progress', { message: '⏸️  === WAITING FOR MANUAL CONSENT SIMULATION ===' });
    logger.debug('consent-sim-v1-progress', { message: '   Reason: Assisted mode requires local execution (GUI needed)' });
    logger.debug('consent-sim-v1-progress', { message: '   Environment: Railway (no display available)' });

    logger.debug('consent-sim-v1-progress', { message: '📋 INSTRUCTIONS:' });
    logger.debug('consent-sim-v1-progress', { message: '   1. Open a terminal on your LOCAL machine (Windows/Mac/Linux)' });
    logger.debug('consent-sim-v1-progress', { message: `   2. Run: node manual-consent-audit.js --url "${websiteUrl}" --audit-id ${auditId} --api-url ${railwayUrl}` });
    logger.debug('consent-sim-v1-progress', { message: '   3. Complete the Reject + Accept scenarios' });
    logger.debug('consent-sim-v1-progress', { message: '   4. Data will be uploaded automatically' });
    logger.debug('consent-sim-v1-progress', { message: '   5. Click "Resume Audit" button in the frontend to continue' });

    return {
      waiting: true,
      skipped: false,
      reason: 'Waiting for manual consent simulation upload from local machine',
      environment: 'Railway',
      auditId: auditId,
      websiteUrl: websiteUrl,
      instructions: `Run locally: node manual-consent-audit.js --url "${websiteUrl}" --audit-id ${auditId} --api-url ${railwayUrl}`,
      rejectScenario: { success: false, pending: true },
      acceptScenario: { success: false, pending: true },
      comparison: null
    };
  }

  // Local execution - check if data already uploaded
  if (!constants.IS_RAILWAY) {
    const existingData = await checkForManualConsentData(auditId, websiteUrl);

    if (existingData) {

      logger.debug('consent-sim-v1-progress', { message: '✅ Using pre-uploaded manual consent simulation data' });
      logger.debug('consent-sim-v1-progress', { message: `   Upload time: ${existingData.uploadedAt}` });

      return existingData.consentSimulation;
    }

    // No data - check if we can run headful browser
    // If headless mode or no GUI, skip and show instructions
    if (constants.PUPPETEER_HEADLESS) {

      logger.debug('consent-sim-v1-progress', { message: '⚠️  === CONSENT SIMULATION SKIPPED ===' });
      logger.debug('consent-sim-v1-progress', { message: '   Reason: PUPPETEER_HEADLESS=true (no GUI for manual interaction)' });
      logger.debug('consent-sim-v1-progress', { message: '   Environment: Local headless mode' });

      logger.debug('consent-sim-v1-progress', { message: '💡 To run consent simulation:' });
      logger.debug('consent-sim-v1-progress', { message: '   Option 1: Set PUPPETEER_HEADLESS=false in .env and restart' });
      logger.debug('consent-sim-v1-progress', { message: `   Option 2: Run manually: node manual-consent-audit.js --url "${websiteUrl}"` });

      return {
        waiting: false,
        skipped: true,
        reason: 'Headless mode enabled - no GUI for manual interaction',
        environment: 'Local',
        rejectScenario: { success: false, skipped: true },
        acceptScenario: { success: false, skipped: true },
        comparison: null
      };
    }
  }

  logger.debug('separator', { line: '═'.repeat(70) });
  logger.debug('consent-sim-v1-progress', { message: '🎭 CONSENT SIMULATION v1.0 - Human-Assisted Browser Session' });
  logger.debug('separator', { line: '═'.repeat(70) });

  logger.debug('consent-sim-v1-progress', { message: '📋 Overview:' });
  logger.debug('consent-sim-v1-progress', { message: '   This audit will launch a VISIBLE browser window' });
  logger.debug('consent-sim-v1-progress', { message: '   You will manually click REJECT and ACCEPT buttons' });
  logger.debug('consent-sim-v1-progress', { message: '   The system will observe real runtime behavior' });

  logger.debug('consent-sim-v1-progress', { message: '⏱️  Estimated time: 1-2 minutes (2 scenarios × 30s each)' });

  logger.debug('separator', { line: '═'.repeat(70) });

  let browser = null;

  try {
    // Launch ONE browser (headless: false for human interaction)
    logger.debug('consent-sim-v1-progress', { message: '🚀 Launching browser (headful mode for human interaction)...' });
    browser = await launchBrowser({
      headless: false, // REQUIRED for human interaction
      protocolTimeout: 60000
    });

    logger.debug('consent-sim-v1-progress', { message: '✅ Browser launched - you should see a browser window open' });

    // Scenario 1: REJECT
    const rejectResult = await runScenario(browser, websiteUrl, 'reject');

    // Scenario 2: ACCEPT
    const acceptResult = await runScenario(browser, websiteUrl, 'accept');

    // Compare states
    const comparison = compareStates(rejectResult.state, acceptResult.state);

    // Close browser
    await closeBrowser(browser);

    const duration = Math.round((Date.now() - startTime) / 1000);

    logger.debug('separator', { line: '═'.repeat(70) });
    logger.debug('consent-sim-v1-progress', { message: `✅ CONSENT SIMULATION COMPLETED in ${duration}s` });
    logger.debug('separator', { line: '═'.repeat(70) });

    return {
      skipped: false,
      rejectScenario: {
        success: true,
        cookies: rejectResult.state.cookies.length,
        networkRequests: rejectResult.state.networkRequests.length,
        localStorageKeys: Object.keys(rejectResult.state.localStorage).length
      },
      acceptScenario: {
        success: true,
        cookies: acceptResult.state.cookies.length,
        networkRequests: acceptResult.state.networkRequests.length,
        localStorageKeys: Object.keys(acceptResult.state.localStorage).length
      },
      comparison: comparison,
      duration: duration
    };

  } catch (error) {
    logger.error('consent-simulation-failed', {
      error: '❌ CONSENT SIMULATION FAILED: ' + error.message,
      auditId,
      websiteUrl,
      stack: error.stack
    });

    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }

    // Return as skipped to prevent audit failure
    return {
      skipped: true,
      error: error.message,
      reason: `Consent simulation failed: ${error.message}`,
      rejectScenario: { success: false, error: error.message },
      acceptScenario: { success: false, error: error.message },
      comparison: null
    };
  }
}

module.exports = {
  runAssistedConsentSimulation,
  runScenario,
  captureState,
  compareStates,
  dedupeCookies
};
