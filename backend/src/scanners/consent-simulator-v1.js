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
const readline = require('readline');
const constants = require('../config/constants');

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

  console.log('');
  console.log('═'.repeat(70));
  console.log(`🎯 HUMAN ACTION REQUIRED - ${scenarioType.toUpperCase()} SCENARIO`);
  console.log('═'.repeat(70));
  console.log('');
  console.log(`  1. Locate the consent banner on the page`);
  console.log(`  2. Click the "${actionText}" button`);
  console.log(`  3. Wait 5 seconds for the page to settle`);
  console.log(`  4. Press ENTER in this terminal to continue`);
  console.log('');
  console.log('═'.repeat(70));
  console.log('');

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Press ENTER after completing the above steps... ', () => {
      rl.close();
      console.log('✅ Continuing with state capture...\n');
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
  console.log('   📸 Capturing state...');

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

  console.log(`   ✅ Captured: ${cookies.length} cookies, ${trackingRequests.length} tracking requests, ${Object.keys(localStorage).length} localStorage items`);

  return {
    cookies: cookies,
    localStorage: localStorage,
    networkRequests: trackingRequests
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
  console.log('');
  console.log('🔍 === DIFF COMPARISON ===');

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
  console.log(`   🍪 Reject cookies: ${rejectCookies.length}`);
  console.log(`   🍪 Accept cookies: ${acceptCookies.length}`);
  console.log(`   ✨ NEW cookies after Accept: ${newCookiesAfterAccept.length}`);
  console.log('');
  console.log(`   📡 Reject tracking requests: ${rejectState.networkRequests.length}`);
  console.log(`   📡 Accept tracking requests: ${acceptState.networkRequests.length}`);
  console.log(`   ✨ NEW tracking domains after Accept: ${newDomainsAfterAccept.length}`);
  console.log('');
  console.log(`   💾 localStorage changes: ${newStorageAfterAccept.length} new keys`);
  console.log('');

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
  console.log('');
  console.log(`${scenarioType === 'reject' ? '🚫' : '✅'} === ${scenarioType.toUpperCase()} SCENARIO ===`);
  console.log(`   Testing: ${websiteUrl}`);

  // Create incognito context (isolated cookies/storage)
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();

  // Setup network listener BEFORE navigation
  const networkRequests = setupNetworkListener(page);

  try {
    // Navigate to URL
    console.log('   🌐 Navigating to page...');
    await page.goto(websiteUrl, {
      waitUntil: 'load',
      timeout: 30000
    });

    // Validate navigation
    const currentUrl = page.url();
    if (currentUrl === 'about:blank') {
      throw new Error('Navigation failed - page is about:blank');
    }

    console.log('   ✅ Page loaded successfully');

    // Wait for human action
    await waitForHumanAction(scenarioType);

    // Capture state after human interaction
    const state = await captureState(page, networkRequests);

    // Close context
    await context.close();

    return {
      success: true,
      state: state
    };

  } catch (error) {
    console.error(`   ❌ ${scenarioType} scenario failed:`, error.message);
    await context.close().catch(() => {});
    throw error;
  }
}

/**
 * Run human-assisted consent simulation (CANONICAL v1.0)
 * @param {string} websiteUrl - URL to test
 * @returns {Promise<Object>} Simulation results
 */
async function runAssistedConsentSimulation(websiteUrl) {
  const startTime = Date.now();

  // Check if running on Railway (no GUI available)
  if (constants.IS_RAILWAY && constants.CONSENT_MODE === 'assisted') {
    console.log('');
    console.log('⚠️  === CONSENT SIMULATION SKIPPED ===');
    console.log('   Reason: Assisted mode requires local execution (GUI needed)');
    console.log('   Environment: Railway (no display available)');
    console.log('   To run consent simulation, execute audit locally with GUI');
    console.log('');

    return {
      skipped: true,
      reason: 'Assisted consent simulation requires local execution with GUI',
      environment: 'Railway',
      rejectScenario: { success: false, skipped: true },
      acceptScenario: { success: false, skipped: true },
      comparison: null
    };
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('🎭 CONSENT SIMULATION v1.0 - Human-Assisted Browser Session');
  console.log('═'.repeat(70));
  console.log('');
  console.log('📋 Overview:');
  console.log('   This audit will launch a VISIBLE browser window');
  console.log('   You will manually click REJECT and ACCEPT buttons');
  console.log('   The system will observe real runtime behavior');
  console.log('');
  console.log('⏱️  Estimated time: 1-2 minutes (2 scenarios × 30s each)');
  console.log('');
  console.log('═'.repeat(70));
  console.log('');

  let browser = null;

  try {
    // Launch ONE browser (headless: false for human interaction)
    console.log('🚀 Launching browser (headful mode for human interaction)...');
    browser = await launchBrowser({
      headless: false, // REQUIRED for human interaction
      protocolTimeout: 60000
    });

    console.log('✅ Browser launched - you should see a browser window open');

    // Scenario 1: REJECT
    const rejectResult = await runScenario(browser, websiteUrl, 'reject');

    // Scenario 2: ACCEPT
    const acceptResult = await runScenario(browser, websiteUrl, 'accept');

    // Compare states
    const comparison = compareStates(rejectResult.state, acceptResult.state);

    // Close browser
    await closeBrowser(browser);

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('');
    console.log('═'.repeat(70));
    console.log(`✅ CONSENT SIMULATION COMPLETED in ${duration}s`);
    console.log('═'.repeat(70));
    console.log('');

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
    console.error('');
    console.error('═'.repeat(70));
    console.error('❌ CONSENT SIMULATION FAILED');
    console.error('═'.repeat(70));
    console.error('Error:', error.message);
    console.error('');

    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }

    return {
      skipped: false,
      error: error.message,
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
