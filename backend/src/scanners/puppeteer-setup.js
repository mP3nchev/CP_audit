const puppeteer = require('puppeteer');
const constants = require('../config/constants');
const { saveErrorScreenshot } = require('../utils/error-logger');

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
 * @returns {Promise<Browser>} Puppeteer browser instance
 */
async function launchBrowser() {
  try {
    const executablePath = findChromiumExecutable();

    const launchOptions = {
      headless: constants.PUPPETEER_HEADLESS,
      protocolTimeout: 10000, // 10s instead of 180s - prevents frozen browser CDP deadlocks
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080'
      ],
      defaultViewport: {
        width: 1920,
        height: 1080
      }
    };

    // Add executablePath only if found
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    console.log('🚀 Launching browser with options:', {
      executablePath: executablePath || 'default',
      headless: launchOptions.headless
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

  // Set user agent
  await page.setUserAgent(
    'Mozilla/5.0 (GDPR-Auditor-Bot/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Set extra HTTP headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9'
  });

  // Set shorter timeout for faster failure detection (15s instead of 120s)
  page.setDefaultNavigationTimeout(15000);

  // Enable request interception (needed for network monitoring)
  await page.setRequestInterception(true);

  console.log('✅ Page created and configured');
  return page;
}

/**
 * Navigate to URL with retry logic and error screenshot capture
 * @param {Page} page - Puppeteer page
 * @param {string} url - URL to navigate to
 * @param {string} auditId - Optional audit ID for error screenshots
 * @param {Object} options - Navigation options (timeout, waitUntil, etc.)
 * @returns {Promise<Response>} Navigation response
 */
async function navigateToUrl(page, url, auditId = 'unknown', options = {}) {
  const defaultTimeout = options.timeout || 30000;
  let response = null;

  console.log(`🌐 Navigating to: ${url}`);

  // STRATEGY 1: Try networkidle2 (optimal - waits for network to be quiet)
  try {
    console.log(`   📡 Strategy 1: Trying networkidle2 (${defaultTimeout}ms timeout)...`);
    response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: defaultTimeout,
      ...options
    });
    console.log(`   ✅ Navigation succeeded with networkidle2`);
  } catch (error) {
    console.log(`   ⚠️  networkidle2 failed: ${error.message}`);

    // STRATEGY 2: Fallback to domcontentloaded (faster, less reliable)
    try {
      console.log(`   📡 Strategy 2: Falling back to domcontentloaded...`);
      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
        ...options
      });
      console.log(`   ✅ Navigation succeeded with domcontentloaded`);
    } catch (error2) {
      console.log(`   ⚠️  domcontentloaded failed: ${error2.message}`);

      // STRATEGY 3: Final fallback to 'load' (baseline)
      try {
        console.log(`   📡 Strategy 3: Final fallback to load event...`);
        response = await page.goto(url, {
          waitUntil: 'load',
          timeout: 15000,
          ...options
        });
        console.log(`   ✅ Navigation succeeded with load event`);
      } catch (error3) {
        console.error(`   ❌ All navigation strategies failed!`);

        // Capture screenshot for debugging
        try {
          const screenshot = await page.screenshot({ fullPage: false });
          await saveErrorScreenshot(screenshot, auditId, 'navigation-failure');
        } catch (screenshotError) {
          console.error('Failed to capture error screenshot:', screenshotError);
        }

        throw error3;
      }
    }
  }

  if (!response) {
    throw new Error('No response received from page');
  }

  const status = response.status();
  console.log(`✅ Page loaded with status: ${status}`);

  if (status >= 400) {
    throw new Error(`HTTP ${status} error`);
  }

  return response;
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
