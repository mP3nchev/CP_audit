const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const constants = require('../config/constants');
const { saveErrorScreenshot } = require('../utils/error-logger');

// Apply stealth plugin — handles 15+ bot detection vectors automatically:
// navigator.webdriver, chrome.app/csi/loadTimes, plugins, languages,
// WebGL, canvas fingerprinting, iframe.contentWindow, etc.
puppeteer.use(StealthPlugin());

/**
 * Find Chromium executable on Railway/Nixpacks
 * @returns {string|undefined} Path to Chromium or undefined
 */
function findChromiumExecutable() {
  const { execSync } = require('child_process');

  // If running on Railway/Nixpacks (detected by RAILWAY_ENVIRONMENT or nixpacks)
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.NIXPACKS_METADATA;

  if (!isRailway) {
    return undefined; // Use default Puppeteer bundled Chromium
  }

  console.log('🔍 Detecting Railway environment, searching for Chromium...');

  // Try to find chromium using 'which' command
  try {
    const chromiumPath = execSync('which chromium', { encoding: 'utf8' }).trim();
    if (chromiumPath) {
      console.log(`✅ Found Chromium at: ${chromiumPath}`);
      return chromiumPath;
    }
  } catch (error) {
    console.log('⚠️  which chromium failed, trying alternative paths...');
  }

  // Try common nix store paths
  const { readdirSync, existsSync } = require('fs');
  try {
    const nixStoreContents = readdirSync('/nix/store');
    const chromiumDir = nixStoreContents.find(dir => dir.includes('chromium-'));

    if (chromiumDir) {
      const chromiumPath = `/nix/store/${chromiumDir}/bin/chromium`;
      if (existsSync(chromiumPath)) {
        console.log(`✅ Found Chromium at: ${chromiumPath}`);
        return chromiumPath;
      }
    }
  } catch (error) {
    console.log('⚠️  Could not search /nix/store:', error.message);
  }

  console.log('⚠️  Could not find Chromium, will try default Puppeteer path');
  return undefined;
}

/**
 * Launch Puppeteer browser with optimized settings
 * @param {Object} customOptions - Custom launch options (protocolTimeout, etc.)
 * @returns {Promise<Browser>} Puppeteer browser instance
 */

/**
 * Detect user's monitor resolution
 * @returns {Object} { width, height }
 */
function getSystemResolution() {
  const { execSync } = require('child_process');

  try {
    // Linux: xrandr
    const output = execSync('xrandr | grep "*" | head -n1', { encoding: 'utf8' });
    const match = output.match(/(\d+)x(\d+)/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  } catch (e) {}

  try {
    // macOS: system_profiler
    const output = execSync('system_profiler SPDisplaysDataType | grep Resolution', { encoding: 'utf8' });
    const match = output.match(/(\d+) x (\d+)/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  } catch (e) {}

  // Fallback: env variable or default
  const width = parseInt(process.env.BROWSER_WIDTH) || 1920;
  const height = parseInt(process.env.BROWSER_HEIGHT) || 1080;
  return { width, height };
}

async function launchBrowser(customOptions = {}) {
  try {
    const executablePath = findChromiumExecutable();

    // Get dynamic viewport resolution (or use defaults)
    const resolution = getSystemResolution();
    console.log(`   🖥️  Viewport: ${resolution.width}x${resolution.height}`);

    const launchOptions = {
      headless: constants.PUPPETEER_HEADLESS ? 'new' : false, // 'new' headless mode — harder to detect than old headless
      protocolTimeout: customOptions.protocolTimeout || 10000, // Default 10s, override for consent simulation
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled', // Prevent CMP bot detection via automation flags
        `--window-size=${resolution.width},${resolution.height}`
      ],
      defaultViewport: {
        width: resolution.width,
        height: resolution.height
      },
      ...customOptions
    };

    // Add executablePath only if found
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    console.log('🚀 Launching browser with options:', {
      executablePath: executablePath || 'default',
      headless: launchOptions.headless,
      protocolTimeout: launchOptions.protocolTimeout
    });

    const browser = await puppeteer.launch(launchOptions);

    console.log('✅ Puppeteer browser launched');
    return browser;
  } catch (error) {
    console.error('❌ Failed to launch Puppeteer:', error.message);
    throw error;
  }
}

/**
 * Create new page with proper configuration
 * @param {Browser} browser - Puppeteer browser instance
 * @returns {Promise<Page>} Configured page instance
 */
async function createPage(browser) {
  const page = await browser.newPage();

  // Stealth plugin (applied at browser level) handles:
  // navigator.webdriver, chrome.app/csi/loadTimes, plugins, languages,
  // WebGL, canvas fingerprinting, permissions API, etc.

  // Set user agent (current Chrome version — outdated versions are a bot signal for CMPs)
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  // Set extra HTTP headers (real browser headers to avoid CMP bot detection)
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9,bg;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1'
  });

  // Set shorter timeout for faster failure detection (15s instead of 120s)
  page.setDefaultNavigationTimeout(15000);

  // Enable request interception (needed for network monitoring)
  await page.setRequestInterception(true);

  console.log('✅ Page created and configured');
  return page;
}

/**
 * Navigate to URL with DOM presence validation (NO networkidle strategies)
 * @param {Page} page - Puppeteer page
 * @param {string} url - URL to navigate to
 * @param {string} auditId - Optional audit ID for error screenshots
 * @param {Object} options - Navigation options (timeout, waitUntil, etc.)
 * @returns {Promise<Response>} Navigation response
 */
async function navigateToUrl(page, url, auditId = 'unknown', options = {}) {
  const timeout = options.timeout || 30000;
  const startTime = Date.now();

  console.log(`🌐 Navigating to: ${url}`);

  try {
    // SINGLE STRATEGY: Use 'load' event only (no networkidle*)
    const response = await page.goto(url, {
      waitUntil: 'load',
      timeout: timeout
    });

    const elapsed = Date.now() - startTime;
    console.log(`   ✅ Navigation completed in ${elapsed}ms`);

    // HARD VALIDATION: Check actual page URL
    const currentUrl = page.url();

    // TERMINAL FAILURE #1: about:blank
    if (currentUrl === 'about:blank') {
      console.error(`   ❌ TERMINAL FAILURE: Page stuck on about:blank`);
      throw new Error('Navigation failed - page is about:blank');
    }

    // TERMINAL FAILURE #2: URL mismatch (redirect to error page, etc.)
    const targetHost = new URL(url).hostname;
    const currentHost = new URL(currentUrl).hostname;

    if (!currentHost.includes(targetHost) && !targetHost.includes(currentHost)) {
      console.error(`   ❌ TERMINAL FAILURE: URL mismatch`);
      console.error(`      Expected: ${url}`);
      console.error(`      Got: ${currentUrl}`);
      throw new Error(`Navigation failed - URL mismatch (expected ${targetHost}, got ${currentHost})`);
    }

    // HARD VALIDATION: Check HTTP status
    if (!response) {
      throw new Error('No response received from navigation');
    }

    const status = response.status();
    console.log(`   📊 HTTP Status: ${status}`);

    if (status >= 400) {
      throw new Error(`HTTP ${status} error`);
    }

    // HARD VALIDATION: Check DOM loaded
    const domReady = await page.evaluate(() => {
      return {
        readyState: document.readyState,
        hasBody: !!document.body,
        bodyChildCount: document.body?.children.length || 0
      };
    });

    console.log(`   🔍 DOM State:`, domReady);

    if (!domReady.hasBody || domReady.bodyChildCount === 0) {
      throw new Error('DOM not loaded - body is empty');
    }

    console.log(`✅ Navigation VALIDATED - page is ready`);
    return response;

  } catch (error) {
    console.error(`   ❌ Navigation FAILED: ${error.message}`);

    // Capture screenshot for debugging
    try {
      const screenshot = await page.screenshot({ fullPage: false });
      await saveErrorScreenshot(screenshot, auditId, 'navigation-failure');
    } catch (screenshotError) {
      console.error('Failed to capture error screenshot:', screenshotError);
    }

    // RE-THROW - no fallback, no retry, HARD FAILURE
    throw error;
  }
}

/**
 * Wait for page to be fully loaded and stable
 * @param {Page} page - Puppeteer page
 * @param {number} waitTime - Additional wait time in ms (default: 3000)
 */
async function waitForPageStability(page, waitTime = 3000) {
  try {
    // Wait for network to be idle
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
      console.log('⚠️  Network not idle after 10s, continuing anyway');
    });

    // Additional wait for dynamic content (using modern setTimeout instead of deprecated waitForTimeout)
    await new Promise(resolve => setTimeout(resolve, waitTime));

    console.log(`✅ Page stable after ${waitTime}ms wait`);
  } catch (error) {
    console.log('⚠️  Page stability check failed, continuing:', error.message);
  }
}

/**
 * Close browser safely
 * @param {Browser} browser - Puppeteer browser instance
 */
async function closeBrowser(browser) {
  if (browser) {
    await browser.close();
    console.log('✅ Browser closed');
  }
}

/**
 * Get page title and URL
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Page metadata
 */
async function getPageMetadata(page) {
  const title = await page.title();
  const url = page.url();

  return { title, url };
}

/**
 * Capture screenshot on error for debugging
 * @param {Page} page - Puppeteer page
 * @param {string} auditId - Audit ID
 * @param {string} errorType - Type of error (timeout, crash, etc.)
 * @returns {Promise<string>} Path to saved screenshot
 */
async function captureErrorScreenshot(page, auditId, errorType = 'error') {
  try {
    if (!page || page.isClosed()) {
      console.log('⚠️  Cannot capture screenshot - page is closed');
      return null;
    }

    const screenshot = await page.screenshot({
      fullPage: false,
      type: 'png'
    });

    const filepath = await saveErrorScreenshot(screenshot, auditId, errorType);
    console.log(`📸 Error screenshot saved: ${filepath}`);

    return filepath;
  } catch (error) {
    console.error('❌ Failed to capture error screenshot:', error);
    return null;
  }
}

module.exports = {
  launchBrowser,
  createPage,
  navigateToUrl,
  waitForPageStability,
  closeBrowser,
  getPageMetadata,
  captureErrorScreenshot
};
