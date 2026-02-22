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

  // 4. Capture screenshot AFTER consent interaction (for evidence)
  let screenshot = null;
  try {
    screenshot = await page.screenshot({ fullPage: false, type: 'png' });
    console.log(`   📸 Screenshot captured (${screenshot.length} bytes)`);

    // Save to /tmp for evidence
    const fs = require('fs');
    const timestamp = Date.now();
    const screenshotPath = `/tmp/consent-${timestamp}.png`;
    fs.writeFileSync(screenshotPath, screenshot);
    console.log(`   💾 Saved: ${screenshotPath}`);
  } catch (e) {
    console.warn(`   ⚠️  Screenshot failed: ${e.message}`);
  }

  console.log(`   ✅ Captured: ${cookies.length} cookies, ${trackingRequests.length} tracking requests, ${Object.keys(localStorage).length} localStorage items`);

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

    // 🎯 NEW: Analyze cookie banner for noyb violations BEFORE user interaction
    // This happens while banner is visible in headful browser
    console.log('');
    console.log('   🔍 Analyzing cookie banner for noyb compliance...');
    let bannerAnalysis = null;
    try {
      bannerAnalysis = await analyzeCookieBanner(page, null, null);
      const passedChecks = bannerAnalysis.totalChecks - bannerAnalysis.skippedCount;
      console.log(`   ✅ Banner analysis complete: ${bannerAnalysis.passedCount}/${passedChecks} checks passed (${bannerAnalysis.compliancePercentage}%)`);
      if (bannerAnalysis.violationCount > 0) {
        console.log(`   ⚠️  Found ${bannerAnalysis.violationCount} violation(s)`);
      }
      if (bannerAnalysis.skippedCount > 0) {
        console.log(`   ⏭️  Skipped ${bannerAnalysis.skippedCount} check(s)`);
      }
    } catch (error) {
      console.warn(`   ⚠️  Banner analysis failed: ${error.message}`);
      bannerAnalysis = {
        error: error.message,
        skipped: true
      };
    }
    console.log('');

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
    console.error(`   ❌ ${scenarioType} scenario failed:`, error.message);
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
    console.error(`Error checking for manual consent data: ${error.message}`);
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

  console.log(`[DEBUG] Consent simulation starting...`);
  console.log(`[DEBUG] IS_RAILWAY: ${constants.IS_RAILWAY}`);
  console.log(`[DEBUG] CONSENT_MODE: ${constants.CONSENT_MODE}`);
  console.log(`[DEBUG] RAILWAY_ENVIRONMENT: ${process.env.RAILWAY_ENVIRONMENT}`);
  console.log(`[DEBUG] auditId: ${auditId}`);

  // Check if running on Railway (no GUI available)
  if (constants.IS_RAILWAY && constants.CONSENT_MODE === 'assisted') {
    console.log(`[DEBUG] Entered Railway block - ALWAYS pausing for manual upload...`);

    // IMPORTANT: Always pause on first run during audit scan
    // Data will be loaded when audit is resumed via continueAuditFromStep17()
    // This prevents re-using old data from previous audits
    const railwayUrl = process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'https://cpaudit-production.up.railway.app';

    console.log('');
    console.log('⏸️  === WAITING FOR MANUAL CONSENT SIMULATION ===');
    console.log('   Reason: Assisted mode requires local execution (GUI needed)');
    console.log('   Environment: Railway (no display available)');
    console.log('');
    console.log('📋 INSTRUCTIONS:');
    console.log('   1. Open a terminal on your LOCAL machine (Windows/Mac/Linux)');
    console.log(`   2. Run: node manual-consent-audit.js --url "${websiteUrl}" --audit-id ${auditId} --api-url ${railwayUrl}`);
    console.log('   3. Complete the Reject + Accept scenarios');
    console.log('   4. Data will be uploaded automatically');
    console.log('   5. Click "Resume Audit" button in the frontend to continue');
    console.log('');

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
      console.log('');
      console.log('✅ Using pre-uploaded manual consent simulation data');
      console.log(`   Upload time: ${existingData.uploadedAt}`);
      console.log('');

      return existingData.consentSimulation;
    }

    // No data - check if we can run headful browser
    // If headless mode or no GUI, skip and show instructions
    if (constants.PUPPETEER_HEADLESS) {
      console.log('');
      console.log('⚠️  === CONSENT SIMULATION SKIPPED ===');
      console.log('   Reason: PUPPETEER_HEADLESS=true (no GUI for manual interaction)');
      console.log('   Environment: Local headless mode');
      console.log('');
      console.log('💡 To run consent simulation:');
      console.log('   Option 1: Set PUPPETEER_HEADLESS=false in .env and restart');
      console.log(`   Option 2: Run manually: node manual-consent-audit.js --url "${websiteUrl}"`);
      console.log('');

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
