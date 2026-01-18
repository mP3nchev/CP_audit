/**
 * Retry handler with exponential backoff
 * Used for Puppeteer operations that may fail due to network issues
 */

/**
 * Execute a function with retry logic
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 500)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 5000)
 * @param {string} options.operationName - Name of operation for logging
 * @returns {Promise<any>} Result of the function
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 500,
    maxDelay = 5000,
    operationName = 'operation'
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      if (attempt > 0) {
        console.log(`✅ ${operationName} succeeded on attempt ${attempt + 1}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        // Calculate exponential backoff delay
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

        console.log(`⚠️  ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`);
        console.log(`   Retrying in ${delay}ms...`);

        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  console.error(`❌ ${operationName} failed after ${maxRetries + 1} attempts`);
  throw lastError;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry specifically for Puppeteer page navigation
 * @param {Page} page - Puppeteer page object
 * @param {string} url - URL to navigate to
 * @param {Object} options - Navigation options
 */
async function retryPageNavigation(page, url, options = {}) {
  return retryWithBackoff(
    async () => {
      return await page.goto(url, {
        waitUntil: 'networkidle2',
        ...options,
        // Default timeout only if not provided
        timeout: options.timeout !== undefined ? options.timeout : 120000
      });
    },
    {
      maxRetries: 3,
      baseDelay: 1000,
      operationName: `Navigate to ${url}`
    }
  );
}

/**
 * Retry specifically for screenshot capture
 * @param {Page} page - Puppeteer page object
 * @param {Object} options - Screenshot options
 */
async function retryScreenshot(page, options = {}) {
  return retryWithBackoff(
    async () => {
      // Build screenshot options with proper precedence
      const screenshotOptions = {
        type: 'png',
        ...options
      };

      // Only set fullPage if clip is not provided and fullPage is not explicitly set
      if (!screenshotOptions.clip && screenshotOptions.fullPage === undefined) {
        screenshotOptions.fullPage = true;
      }

      return await page.screenshot(screenshotOptions);
    },
    {
      maxRetries: 2,
      baseDelay: 500,
      operationName: 'Capture screenshot'
    }
  );
}

/**
 * Retry specifically for blob storage upload
 * @param {Function} uploadFn - Upload function
 * @param {string} filename - File name
 */
async function retryBlobUpload(uploadFn, filename) {
  return retryWithBackoff(
    uploadFn,
    {
      maxRetries: 3,
      baseDelay: 500,
      maxDelay: 2000,
      operationName: `Upload ${filename}`
    }
  );
}

module.exports = {
  retryWithBackoff,
  retryPageNavigation,
  retryScreenshot,
  retryBlobUpload,
  sleep
};
