const { retryScreenshot } = require('../utils/retry-handler');

/**
 * Capture full page screenshot
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Buffer>} Screenshot buffer
 */
async function captureFullPage(page) {
  try {
    console.log('📸 Capturing full page screenshot...');

    const screenshot = await retryScreenshot(page, {
      fullPage: true,
      type: 'png'
    });

    console.log(`✅ Full page screenshot captured (${(screenshot.length / 1024).toFixed(2)} KB)`);
    return screenshot;
  } catch (error) {
    console.error('❌ Failed to capture full page screenshot:', error.message);
    throw error;
  }
}

/**
 * Capture cookie banner screenshot
 * Attempts to find and capture the cookie banner specifically
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

    // Try to find banner element
    let bannerElement = null;
    for (const selector of bannerSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          // Check if element is visible
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            bannerElement = element;
            console.log(`✅ Found cookie banner: ${selector}`);
            break;
          }
        }
      } catch (err) {
        // Continue to next selector
      }
    }

    if (!bannerElement) {
      console.log('⚠️  Cookie banner not found or not visible');
      return null;
    }

    // Capture screenshot of the banner element
    const screenshot = await retryScreenshot(page, {
      clip: await bannerElement.boundingBox(),
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

    // Small delay for animations
    await page.waitForTimeout(1000);

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
