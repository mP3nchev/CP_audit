#!/usr/bin/env node
/**
 * Manual Consent Audit - Headful Puppeteer Script
 *
 * Purpose: Allow human-assisted cookie consent interaction with full CDP monitoring
 * Usage: node manual-consent-audit.js --url https://example.com
 *
 * Workflow:
 * 1. Opens headful Chrome browser
 * 2. Monitors cookies, localStorage, sessionStorage, network via CDP
 * 3. Pauses for user interaction (CLI prompt)
 * 4. Captures consent state (accept/reject scenarios)
 * 5. Auto-exports JSON to backend API or local file
 */

const puppeteer = require('puppeteer');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');

// ============================================
// CLI ARGUMENT PARSING
// ============================================
const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const outputIndex = args.indexOf('--output');
const apiUrlIndex = args.indexOf('--api');

if (urlIndex === -1 || !args[urlIndex + 1]) {
  console.error('❌ Error: --url parameter required');
  console.log('Usage: node manual-consent-audit.js --url https://example.com [--output results.json] [--api http://localhost:3001]');
  process.exit(1);
}

const WEBSITE_URL = args[urlIndex + 1];
const OUTPUT_FILE = outputIndex !== -1 ? args[outputIndex + 1] : null;
const API_URL = apiUrlIndex !== -1 ? args[apiUrlIndex + 1] : process.env.API_URL || null;

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('🎭 MANUAL CONSENT AUDIT - Human-Assisted Browser Session');
console.log('═══════════════════════════════════════════════════════');
console.log(`   Website: ${WEBSITE_URL}`);
console.log(`   Output: ${OUTPUT_FILE || 'API upload only'}`);
console.log(`   API: ${API_URL || 'Not configured'}`);
console.log('');

// ============================================
// READLINE INTERFACE FOR USER INTERACTION
// ============================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// ============================================
// CDP MONITORING SETUP
// ============================================
async function setupCDPMonitoring(page) {
  const client = await page.target().createCDPSession();

  // Enable CDP domains
  await client.send('Network.enable');
  // Note: Storage.enable removed - not needed for cookie capture (using Network.getAllCookies instead)

  const monitoringData = {
    cookies: [],
    localStorage: [],
    sessionStorage: [],
    networkRequests: [],
    cookieWrites: [], // JS-set cookies
    storageWrites: [] // localStorage/sessionStorage writes
  };

  // ============================================
  // INTERCEPT: Cookie writes (document.cookie)
  // ============================================
  await page.evaluateOnNewDocument(() => {
    window.__manualAuditData = {
      cookieWrites: [],
      storageWrites: [],
      startTime: Date.now(),
      userInteractionTime: null
    };

    // Hook document.cookie setter
    const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      get() {
        return originalCookieDescriptor.get.call(document);
      },
      set(value) {
        window.__manualAuditData.cookieWrites.push({
          value,
          timestamp: Date.now(),
          stackTrace: new Error().stack
        });
        return originalCookieDescriptor.set.call(document, value);
      }
    });

    // Hook localStorage.setItem
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      window.__manualAuditData.storageWrites.push({
        type: this === window.localStorage ? 'localStorage' : 'sessionStorage',
        key,
        value,
        timestamp: Date.now()
      });
      return originalSetItem.call(this, key, value);
    };

    // Track first user interaction
    ['click', 'keydown', 'touchstart'].forEach(evt => {
      window.addEventListener(evt, () => {
        if (!window.__manualAuditData.userInteractionTime) {
          window.__manualAuditData.userInteractionTime = Date.now();
          console.log('🖱️  First user interaction detected');
        }
      }, { once: true, capture: true });
    });
  });

  // ============================================
  // CDP: Network request monitoring
  // ============================================
  client.on('Network.requestWillBeSent', (params) => {
    monitoringData.networkRequests.push({
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      timestamp: params.timestamp,
      type: params.type,
      initiator: params.initiator
    });
  });

  return { client, monitoringData };
}

// ============================================
// CAPTURE STATE SNAPSHOT
// ============================================
async function captureStateSnapshot(page, client, label) {
  console.log(`   📸 Capturing ${label} snapshot...`);

  // 1. Cookies via CDP (most comprehensive)
  let cookies = [];
  try {
    const result = await client.send('Network.getAllCookies');
    cookies = result.cookies;
  } catch (err) {
    // CDP session may be detached if page reloaded - try to recreate
    console.log(`   ℹ️  CDP session detached, recreating...`);
    try {
      const newClient = await page.target().createCDPSession();
      await newClient.send('Network.enable');
      const result = await newClient.send('Network.getAllCookies');
      cookies = result.cookies;
      await newClient.detach();
    } catch (err2) {
      console.log(`   ⚠️  Could not capture cookies via CDP: ${err2.message}`);
      // Fallback to document.cookie
      cookies = await page.evaluate(() => {
        return document.cookie.split(';').map(c => {
          const [name, value] = c.trim().split('=');
          return { name, value };
        }).filter(c => c.name);
      });
    }
  }

  // 2. LocalStorage via CDP
  const storageItems = await page.evaluate(() => {
    const ls = {};
    const ss = {};

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        ls[key] = localStorage.getItem(key);
      }
    } catch (e) {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        ss[key] = sessionStorage.getItem(key);
      }
    } catch (e) {}

    return { localStorage: ls, sessionStorage: ss };
  });

  // 3. Get JS tracking data
  const trackingData = await page.evaluate(() => {
    return window.__manualAuditData || {};
  });

  // 4. Screenshot
  const screenshot = await page.screenshot({
    encoding: 'base64',
    fullPage: true
  });

  return {
    label,
    timestamp: new Date().toISOString(),
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
      size: c.value.length
    })),
    localStorage: storageItems.localStorage,
    sessionStorage: storageItems.sessionStorage,
    trackingData: {
      cookieWrites: trackingData.cookieWrites || [],
      storageWrites: trackingData.storageWrites || [],
      userInteractionTime: trackingData.userInteractionTime
    },
    screenshot: screenshot.substring(0, 100) + '... (base64 truncated)'
  };
}

// ============================================
// RUN REJECT SCENARIO
// ============================================
async function runRejectScenario(browser, websiteUrl) {
  console.log('');
  console.log('🚫 === REJECT SCENARIO ===');

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Setup CDP monitoring
  const { client, monitoringData } = await setupCDPMonitoring(page);

  // Navigate
  console.log(`   📡 Navigating to ${websiteUrl}...`);
  await page.goto(websiteUrl, {
    waitUntil: 'networkidle2',
    timeout: 60000
  });
  console.log(`   ✅ Page loaded`);

  // Wait for dynamic content to stabilize (cookie banner, overlays, etc.)
  console.log(`   ⏳ Waiting 5 seconds for UI elements to stabilize...`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Force cookie banner to stay visible (prevent auto-hide scripts)
  console.log(`   🔧 Forcing cookie banner to stay visible...`);
  await page.evaluate(() => {
    // Find CookieScript banner (most common selectors)
    const selectors = [
      '#cookiescript_injected',
      '#cookiescript_injected_wrapper',
      '[id*="cookiescript"]',
      '[class*="cookie-banner"]',
      '[class*="cookie-consent"]',
      '[id*="cookie-banner"]',
      '[id*="CybotCookiebotDialog"]',
      '.cc-window',
      '#onetrust-banner-sdk'
    ];

    let banner = null;
    for (const selector of selectors) {
      banner = document.querySelector(selector);
      if (banner) {
        console.log(`Found banner: ${selector}`);
        break;
      }
    }

    if (banner) {
      // Force visibility with !important-level overrides
      banner.style.setProperty('display', 'block', 'important');
      banner.style.setProperty('visibility', 'visible', 'important');
      banner.style.setProperty('opacity', '1', 'important');
      banner.style.setProperty('z-index', '2147483647', 'important');
      banner.style.setProperty('position', 'fixed', 'important');
      banner.style.setProperty('pointer-events', 'auto', 'important');

      // Prevent parent containers from hiding it
      let parent = banner.parentElement;
      while (parent && parent !== document.body) {
        parent.style.setProperty('display', 'block', 'important');
        parent.style.setProperty('visibility', 'visible', 'important');
        parent.style.setProperty('opacity', '1', 'important');
        parent = parent.parentElement;
      }

      // Install MutationObserver to prevent hiding
      const observer = new MutationObserver(() => {
        banner.style.setProperty('display', 'block', 'important');
        banner.style.setProperty('visibility', 'visible', 'important');
        banner.style.setProperty('opacity', '1', 'important');
      });

      observer.observe(banner, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });

      // Also observe parent to prevent removal
      if (banner.parentElement) {
        observer.observe(banner.parentElement, {
          childList: true,
          subtree: false
        });
      }

      console.log('✅ Banner forced to stay visible');
      return true;
    } else {
      console.warn('⚠️  No cookie banner found');
      return false;
    }
  });

  // Capture BEFORE consent
  const beforeSnapshot = await captureStateSnapshot(page, client, 'before_interaction');
  console.log(`   🍪 Cookies before interaction: ${beforeSnapshot.cookies.length}`);

  // PAUSE for user interaction (REJECT)
  console.log('');
  console.log('   ⏸️  PAUSE: Please interact with the cookie banner');
  console.log('   ');
  console.log('   🎯 INSTRUCTIONS:');
  console.log('   1. Look at the Chrome window - do you see the cookie banner?');
  console.log('   2. If banner disappeared, refresh the page (F5) and wait');
  console.log('   3. Click "REJECT ALL" or "Cookie Settings" → reject categories');
  console.log('   4. Wait 3 seconds after clicking');
  console.log('   5. Come back to this terminal and press ENTER');
  console.log('');

  // Start listening for navigation before user clicks
  const navigationPromise = page.waitForNavigation({
    timeout: 10000,
    waitUntil: 'networkidle2'
  }).catch(() => null); // Ignore timeout if no navigation

  await askQuestion('   Press ENTER when you have rejected cookies... ');

  // Check if page reloaded/navigated after clicking
  const didNavigate = await navigationPromise;
  if (didNavigate) {
    console.log(`   🔄 Page reloaded after reject - waiting for stabilization...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  } else {
    console.log(`   ℹ️  No page reload detected`);
  }

  // Wait for tracking to propagate
  console.log(`   ⏱️  Waiting 5 seconds for tracking runtime propagation...`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Capture AFTER reject
  const afterSnapshot = await captureStateSnapshot(page, client, 'after_reject');
  console.log(`   🍪 Cookies after reject: ${afterSnapshot.cookies.length}`);

  // Clean up page (CDP session auto-closes with page)
  try {
    await page.close();
  } catch (err) {
    console.log(`   ℹ️  Page already closed`);
  }

  return {
    scenario: 'reject',
    websiteUrl,
    before: beforeSnapshot,
    after: afterSnapshot,
    networkRequests: monitoringData.networkRequests
  };
}

// ============================================
// RUN ACCEPT SCENARIO
// ============================================
async function runAcceptScenario(browser, websiteUrl) {
  console.log('');
  console.log('✅ === ACCEPT SCENARIO ===');

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Setup CDP monitoring
  const { client, monitoringData } = await setupCDPMonitoring(page);

  // Navigate
  console.log(`   📡 Navigating to ${websiteUrl}...`);
  await page.goto(websiteUrl, {
    waitUntil: 'networkidle2',
    timeout: 60000
  });
  console.log(`   ✅ Page loaded`);

  // Wait for dynamic content to stabilize (cookie banner, overlays, etc.)
  console.log(`   ⏳ Waiting 5 seconds for UI elements to stabilize...`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Force cookie banner to stay visible (prevent auto-hide scripts)
  console.log(`   🔧 Forcing cookie banner to stay visible...`);
  await page.evaluate(() => {
    // Find CookieScript banner (most common selectors)
    const selectors = [
      '#cookiescript_injected',
      '#cookiescript_injected_wrapper',
      '[id*="cookiescript"]',
      '[class*="cookie-banner"]',
      '[class*="cookie-consent"]',
      '[id*="cookie-banner"]',
      '[id*="CybotCookiebotDialog"]',
      '.cc-window',
      '#onetrust-banner-sdk'
    ];

    let banner = null;
    for (const selector of selectors) {
      banner = document.querySelector(selector);
      if (banner) {
        console.log(`Found banner: ${selector}`);
        break;
      }
    }

    if (banner) {
      // Force visibility with !important-level overrides
      banner.style.setProperty('display', 'block', 'important');
      banner.style.setProperty('visibility', 'visible', 'important');
      banner.style.setProperty('opacity', '1', 'important');
      banner.style.setProperty('z-index', '2147483647', 'important');
      banner.style.setProperty('position', 'fixed', 'important');
      banner.style.setProperty('pointer-events', 'auto', 'important');

      // Prevent parent containers from hiding it
      let parent = banner.parentElement;
      while (parent && parent !== document.body) {
        parent.style.setProperty('display', 'block', 'important');
        parent.style.setProperty('visibility', 'visible', 'important');
        parent.style.setProperty('opacity', '1', 'important');
        parent = parent.parentElement;
      }

      // Install MutationObserver to prevent hiding
      const observer = new MutationObserver(() => {
        banner.style.setProperty('display', 'block', 'important');
        banner.style.setProperty('visibility', 'visible', 'important');
        banner.style.setProperty('opacity', '1', 'important');
      });

      observer.observe(banner, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });

      // Also observe parent to prevent removal
      if (banner.parentElement) {
        observer.observe(banner.parentElement, {
          childList: true,
          subtree: false
        });
      }

      console.log('✅ Banner forced to stay visible');
      return true;
    } else {
      console.warn('⚠️  No cookie banner found');
      return false;
    }
  });

  // Capture BEFORE consent
  const beforeSnapshot = await captureStateSnapshot(page, client, 'before_interaction');
  console.log(`   🍪 Cookies before interaction: ${beforeSnapshot.cookies.length}`);

  // PAUSE for user interaction (ACCEPT)
  console.log('');
  console.log('   ⏸️  PAUSE: Please interact with the cookie banner');
  console.log('   ');
  console.log('   🎯 INSTRUCTIONS:');
  console.log('   1. Look at the Chrome window - do you see the cookie banner?');
  console.log('   2. If banner disappeared, refresh the page (F5) and wait');
  console.log('   3. Click "ACCEPT ALL"');
  console.log('   4. Wait 3 seconds after clicking');
  console.log('   5. Come back to this terminal and press ENTER');
  console.log('');

  // Start listening for navigation before user clicks
  const navigationPromise = page.waitForNavigation({
    timeout: 10000,
    waitUntil: 'networkidle2'
  }).catch(() => null); // Ignore timeout if no navigation

  await askQuestion('   Press ENTER when you have accepted cookies... ');

  // Check if page reloaded/navigated after clicking
  const didNavigate = await navigationPromise;
  if (didNavigate) {
    console.log(`   🔄 Page reloaded after accept - waiting for stabilization...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  } else {
    console.log(`   ℹ️  No page reload detected`);
  }

  // Wait for tracking to propagate (longer for accept - analytics needs time)
  console.log(`   ⏱️  Waiting 5 seconds for tracking runtime initialization...`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Capture AFTER accept
  const afterSnapshot = await captureStateSnapshot(page, client, 'after_accept');
  console.log(`   🍪 Cookies after accept: ${afterSnapshot.cookies.length}`);

  // Clean up page (CDP session auto-closes with page)
  try {
    await page.close();
  } catch (err) {
    console.log(`   ℹ️  Page already closed`);
  }

  return {
    scenario: 'accept',
    websiteUrl,
    before: beforeSnapshot,
    after: afterSnapshot,
    networkRequests: monitoringData.networkRequests
  };
}

// ============================================
// MAIN WORKFLOW
// ============================================
async function main() {
  let browser;

  try {
    // Launch HEADFUL browser
    console.log('🚀 Launching browser (headful mode)...');
    browser = await puppeteer.launch({
      headless: false, // CRITICAL: must be headful for user interaction
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    console.log('✅ Browser launched\n');

    // Run REJECT scenario first (clean state)
    const rejectResults = await runRejectScenario(browser, WEBSITE_URL);

    // Ask if user wants to continue with ACCEPT scenario
    console.log('');
    const continueAccept = await askQuestion('   🔄 Run ACCEPT scenario? (y/n): ');

    let acceptResults = null;
    if (continueAccept.toLowerCase() === 'y') {
      acceptResults = await runAcceptScenario(browser, WEBSITE_URL);
    }

    // ============================================
    // BUILD FINAL RESULTS
    // ============================================
    const finalResults = {
      timestamp: new Date().toISOString(),
      websiteUrl: WEBSITE_URL,
      scenarios: {
        reject: rejectResults,
        accept: acceptResults
      },
      metadata: {
        userAgent: await browser.userAgent(),
        viewport: { width: 1920, height: 1080 }
      }
    };

    // ============================================
    // SAVE TO FILE (if specified)
    // ============================================
    if (OUTPUT_FILE) {
      const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
      await fs.writeFile(outputPath, JSON.stringify(finalResults, null, 2));
      console.log('');
      console.log(`✅ Results saved to: ${outputPath}`);
    }

    // ============================================
    // UPLOAD TO API (if specified)
    // ============================================
    if (API_URL) {
      console.log('');
      console.log(`📤 Uploading results to API: ${API_URL}/api/audit/manual-consent/upload`);

      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`${API_URL}/api/audit/manual-consent/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalResults)
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Upload successful: ${data.message || 'OK'}`);
        if (data.audit_id) {
          console.log(`   Audit ID: ${data.audit_id}`);
          console.log(`   Report URL: ${API_URL}/api/audit/${data.audit_id}/report`);
        }
      } else {
        console.error(`❌ Upload failed: ${response.status} ${response.statusText}`);
      }
    }

    // ============================================
    // SUMMARY
    // ============================================
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   Reject scenario:`);
    console.log(`      Cookies before: ${rejectResults.before.cookies.length}`);
    console.log(`      Cookies after:  ${rejectResults.after.cookies.length}`);
    console.log(`      Network requests: ${rejectResults.networkRequests.length}`);

    if (acceptResults) {
      console.log(`   Accept scenario:`);
      console.log(`      Cookies before: ${acceptResults.before.cookies.length}`);
      console.log(`      Cookies after:  ${acceptResults.after.cookies.length}`);
      console.log(`      Network requests: ${acceptResults.networkRequests.length}`);

      const cookieDifference = acceptResults.after.cookies.length - rejectResults.after.cookies.length;
      console.log(`   Cookie difference (Accept vs Reject): ${cookieDifference > 0 ? '+' : ''}${cookieDifference}`);
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
    rl.close();
  }
}

// Start the script
main().then(() => {
  console.log('✅ Manual consent audit completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
