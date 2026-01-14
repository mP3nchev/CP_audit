/**
 * Tracking Before Consent Detection
 * Implements GDPR Article 5(3) ePrivacy Directive compliance check
 *
 * Detects creation of persistent identifiers before any user interaction
 */

/**
 * Inject tracking detection code into page BEFORE navigation
 * @param {Page} page - Puppeteer page
 */
async function injectTrackingDetector(page) {
  await page.evaluateOnNewDocument(() => {
    // Initialize tracking data storage
    window.__trackingData = {
      cookieWrites: [],
      lsWrites: [],
      idbWrites: [],
      firstUserActionAt: null
    };

    // Track first user interaction
    ['click', 'keydown', 'touchstart'].forEach(evt => {
      window.addEventListener(evt, () => {
        if (!window.__trackingData.firstUserActionAt) {
          window.__trackingData.firstUserActionAt = Date.now();
        }
      }, { once: true, capture: true });
    });

    // Intercept cookie writes
    const originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      set(value) {
        window.__trackingData.cookieWrites.push({
          value,
          timestamp: Date.now()
        });
        originalCookie.set.call(document, value);
      },
      get() {
        return originalCookie.get.call(document);
      }
    });

    // Intercept localStorage writes
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      window.__trackingData.lsWrites.push({
        key,
        value,
        timestamp: Date.now()
      });
      return originalSetItem.apply(this, arguments);
    };

    // Intercept IndexedDB opens
    const originalOpen = indexedDB.open;
    indexedDB.open = function(name) {
      window.__trackingData.idbWrites.push({
        name,
        timestamp: Date.now()
      });
      return originalOpen.apply(this, arguments);
    };
  });

  console.log('✅ Tracking detector injected');
}

/**
 * Extract tracking data from page
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Tracking data
 */
async function extractTrackingData(page) {
  try {
    const trackingData = await page.evaluate(() => {
      return window.__trackingData || {
        cookieWrites: [],
        lsWrites: [],
        idbWrites: [],
        firstUserActionAt: null
      };
    });

    return trackingData;
  } catch (error) {
    console.error('❌ Failed to extract tracking data:', error.message);
    return {
      cookieWrites: [],
      lsWrites: [],
      idbWrites: [],
      firstUserActionAt: null
    };
  }
}

/**
 * Analyze tracking data to detect violations
 * @param {Object} trackingData - Tracking data from page
 * @param {Array} cookies - Current cookies from page
 * @returns {Object} Analysis results
 */
function analyzeTracking(trackingData, cookies) {
  const violations = [];
  const firstInteraction = trackingData.firstUserActionAt;

  // Analyze cookie writes
  trackingData.cookieWrites.forEach(write => {
    const cookieData = parseCookieString(write.value);

    if (isPersistent(cookieData) &&
        looksLikeIdentifier(cookieData.value) &&
        (firstInteraction === null || write.timestamp < firstInteraction)) {

      violations.push({
        type: 'cookie',
        name: cookieData.name,
        value: cookieData.value,
        timestamp: write.timestamp,
        persistent: true,
        isIdentifier: true,
        beforeConsent: true
      });
    }
  });

  // Analyze localStorage writes
  trackingData.lsWrites.forEach(write => {
    if (looksLikeIdentifier(write.value) &&
        (firstInteraction === null || write.timestamp < firstInteraction)) {

      violations.push({
        type: 'localStorage',
        name: write.key,
        value: write.value,
        timestamp: write.timestamp,
        persistent: true,
        isIdentifier: true,
        beforeConsent: true
      });
    }
  });

  // Analyze IndexedDB writes
  trackingData.idbWrites.forEach(write => {
    if (firstInteraction === null || write.timestamp < firstInteraction) {
      violations.push({
        type: 'indexedDB',
        name: write.name,
        timestamp: write.timestamp,
        persistent: true,
        beforeConsent: true
      });
    }
  });

  const result = {
    trackingBeforeConsent: violations.length > 0,
    violationCount: violations.length,
    identifiedTrackers: violations,
    firstInteraction: firstInteraction,
    summary: violations.length > 0
      ? `Detected ${violations.length} persistent identifier(s) created before user interaction`
      : 'No tracking before consent detected'
  };

  if (result.trackingBeforeConsent) {
    console.log(`⚠️  VIOLATION: ${result.summary}`);
  } else {
    console.log('✅ No tracking before consent detected');
  }

  return result;
}

/**
 * Parse cookie string into object
 * @param {string} cookieStr - Cookie string
 * @returns {Object} Parsed cookie data
 */
function parseCookieString(cookieStr) {
  const parts = cookieStr.split(';').map(p => p.trim());
  const [nameValue] = parts;
  const [name, value] = nameValue.split('=');

  const cookie = { name, value };

  parts.slice(1).forEach(part => {
    const [key, val] = part.split('=');
    cookie[key.toLowerCase()] = val || true;
  });

  return cookie;
}

/**
 * Check if cookie is persistent (has expires or max-age)
 * @param {Object} cookieData - Parsed cookie data
 * @returns {boolean} True if persistent
 */
function isPersistent(cookieData) {
  return !!(cookieData.expires || cookieData['max-age']);
}

/**
 * Check if value looks like an identifier (has sufficient entropy)
 * @param {string} value - Value to check
 * @returns {boolean} True if looks like identifier
 */
function looksLikeIdentifier(value) {
  if (typeof value !== 'string' || value.length < 8) {
    return false;
  }

  // Must contain both letters and digits (entropy check)
  const hasLetters = /[a-z]/i.test(value);
  const hasDigits = /\d/.test(value);

  return hasLetters && hasDigits;
}

/**
 * Filter out false positives (language cookies, feature flags, etc.)
 * @param {Array} violations - Array of violations
 * @returns {Array} Filtered violations
 */
function filterFalsePositives(violations) {
  const falsePositivePatterns = [
    /^(en|de|fr|es|it|pt|nl|pl|ru|bg)$/i,  // Language codes
    /^(true|false|enabled|disabled)$/i,     // Feature flags
    /^(light|dark)$/i,                      // Theme preferences
  ];

  return violations.filter(v => {
    const isFalsePositive = falsePositivePatterns.some(pattern =>
      pattern.test(v.value)
    );
    return !isFalsePositive;
  });
}

module.exports = {
  injectTrackingDetector,
  extractTrackingData,
  analyzeTracking,
  looksLikeIdentifier,
  filterFalsePositives
};
