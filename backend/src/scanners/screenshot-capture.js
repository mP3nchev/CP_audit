const { retryScreenshot } = require('../utils/retry-handler');

/**
 * Calculate dynamic height cap based on available memory
 * @returns {number} Max height in pixels
 */
function getDynamicHeightCap() {
  try {
    const memUsage = process.memoryUsage();
    const availableMemoryMB = (memUsage.heapTotal - memUsage.heapUsed) / 1024 / 1024;

    // Conservative caps based on available memory
    if (availableMemoryMB > 500) return 32000;  // High memory
    if (availableMemoryMB > 250) return 16384;  // Medium memory
    return 8192;  // Low memory - safer fallback
  } catch (error) {
    return 16384;  // Default fallback
  }
}

/**
 * Capture full page screenshot with dynamic height cap
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Buffer>} Screenshot buffer
 */
async function captureFullPage(page) {
  try {
    console.log('📸 Capturing full page screenshot...');

    const heightCap = getDynamicHeightCap();

    // Get page dimensions
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    }));

    // Check if page exceeds height cap
    if (dimensions.height > heightCap) {
      console.log(`⚠️  Page height (${dimensions.height}px) exceeds cap (${heightCap}px), using capped screenshot`);

      const screenshot = await retryScreenshot(page, {
        clip: {
          x: 0,
          y: 0,
          width: dimensions.width,
          height: heightCap
        },
        type: 'png'
      });

      console.log(`✅ Capped screenshot captured (${(screenshot.length / 1024).toFixed(2)} KB)`);
      return screenshot;
    }

    // Normal fullPage screenshot
    const screenshot = await retryScreenshot(page, {
      fullPage: true,
      type: 'png'
    });

    console.log(`✅ Full page screenshot captured (${(screenshot.length / 1024).toFixed(2)} KB)`);
    return screenshot;
  } catch (error) {
    console.error('❌ Full page screenshot failed, trying viewport fallback:', error.message);

    // Fallback to viewport screenshot
    try {
      const screenshot = await retryScreenshot(page, {
        type: 'png'
      });
      console.log(`✅ Viewport screenshot captured as fallback (${(screenshot.length / 1024).toFixed(2)} KB)`);
      return screenshot;
    } catch (fallbackError) {
      console.error('❌ Failed to capture viewport screenshot:', fallbackError.message);
      throw fallbackError;
    }
  }
}

/**
 * Capture cookie banner screenshot with robust detection
 * Attempts to find and capture the cookie banner with visibility/stability checks
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Buffer|null>} Screenshot buffer or null if banner not found
 */
async function captureCookieBanner(page) {
  try {
    console.log('📸 Looking for cookie banner...');

    // Common selectors for cookie banners
    const bannerSelectors = [
      '#cookie-banner',
      '#cookie-consent',
      '#cookie-notice',
      '.cookie-banner',
      '.cookie-consent',
      '.cookie-notice',
      '[id*="cookie"]',
      '[class*="cookie"]',
      '[id*="consent"]',
      '[class*="consent"]',
      '#onetrust-banner-sdk',
      '#CybotCookiebotDialog',
      '.cc-window',
      '.cc-banner'
    ];

    // Try to find and wait for banner element with visibility check
    let bannerElement = null;
    let usedSelector = null;

    for (const selector of bannerSelectors) {
      try {
        // Wait for selector with visible option (5s timeout)
        await page.waitForSelector(selector, {
          visible: true,
          timeout: 5000
        });

        const element = await page.$(selector);
        if (element) {
          // Additional check: wait for element to be fully rendered (animations complete)
          const isFullyRendered = await page.waitForFunction(
            (sel) => {
              const el = document.querySelector(sel);
              if (!el) return false;

              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();

              // Check visibility, dimensions, and opacity
              return rect.width > 50 &&
                     rect.height > 50 &&
                     style.visibility !== 'hidden' &&
                     style.display !== 'none' &&
                     parseFloat(style.opacity) > 0.5;
            },
            { timeout: 2000 },
            selector
          ).catch(() => false);

          if (isFullyRendered) {
            bannerElement = element;
            usedSelector = selector;
            console.log(`✅ Found cookie banner: ${selector}`);
            break;
          }
        }
      } catch (err) {
        // Continue to next selector (timeout or not found)
        continue;
      }
    }

    if (!bannerElement) {
      console.log('⚠️  Cookie banner not found or not visible');
      return null;
    }

    // Get bounding box
    const boundingBox = await bannerElement.boundingBox();

    if (!boundingBox) {
      console.log('⚠️  Cookie banner has no bounding box');
      return null;
    }

    // Capture screenshot of the banner element (use clip, NOT fullPage)
    const screenshot = await retryScreenshot(page, {
      clip: boundingBox,
      type: 'png'
    });

    console.log(`✅ Cookie banner screenshot captured (${(screenshot.length / 1024).toFixed(2)} KB)`);
    return screenshot;
  } catch (error) {
    console.error('⚠️  Failed to capture cookie banner:', error.message);
    return null;
  }
}

/**
 * Capture both screenshots (full page + cookie banner)
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Object with both screenshots
 */
async function captureScreenshots(page) {
  const screenshots = {};

  try {
    // Capture full page (required)
    screenshots.full = await captureFullPage(page);

    // Capture cookie banner (optional)
    screenshots.banner = await captureCookieBanner(page);

    return screenshots;
  } catch (error) {
    console.error('❌ Screenshot capture failed:', error.message);
    throw error;
  }
}

/**
 * Wait for page to be stable before screenshot
 * @param {Page} page - Puppeteer page
 */
async function waitForStableView(page) {
  try {
    // Wait for images to load
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete)
          .map(img => new Promise(resolve => {
            img.onload = img.onerror = resolve;
          }))
      );
    });

    // Wait for animations and dynamic content to settle using native setTimeout
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('✅ Page stable for screenshot');
  } catch (error) {
    console.log('⚠️  Page stability check incomplete:', error.message);
  }
}

module.exports = {
  captureFullPage,
  captureCookieBanner,
  captureScreenshots,
  waitForStableView
};
