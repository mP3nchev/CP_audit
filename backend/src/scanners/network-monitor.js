/**
 * Network request monitoring
 * Tracks all network requests and identifies tracking requests
 */

const TRACKING_DOMAINS = require('../config/tracking-domains.json');

/**
 * Setup network monitoring on a page
 * @param {Page} page - Puppeteer page
 * @returns {Object} Network monitor instance with methods
 */
function setupNetworkMonitoring(page) {
  const networkRequests = [];
  const trackingRequests = [];
  let pageLoadTime = null;
  let firstUserInteraction = null;

  // Track page load start time
  const startTime = Date.now();

  // Listen to all network requests
  page.on('request', request => {
    const timestamp = (Date.now() - startTime) / 1000; // Convert to seconds

    // Check if it's a tracking request
    const isTracking = isTrackingRequest(request.url(), request.resourceType());

    const requestData = {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      timestamp: timestamp,
      beforeConsent: firstUserInteraction === null || timestamp < firstUserInteraction,
      headers: request.headers(),
      isTracking: isTracking,
      domain: isTracking ? (() => { try { return new URL(request.url()).hostname; } catch { return undefined; } })() : undefined
    };

    networkRequests.push(requestData);

    // Add to tracking requests array if it's a tracking request
    if (isTracking) {
      trackingRequests.push(requestData);
    }

    // Continue the request (required when interception is enabled)
    request.continue().catch(() => {});
  });

  // Track responses
  page.on('response', response => {
    const request = networkRequests.find(r => r.url === response.url());
    if (request) {
      request.responseStatus = response.status();
      request.responseHeaders = response.headers();
    }
  });

  return {
    /**
     * Mark that page has finished loading
     */
    markPageLoaded() {
      pageLoadTime = (Date.now() - startTime) / 1000;
      console.log(`✅ Page loaded in ${pageLoadTime.toFixed(2)}s`);
    },

    /**
     * Mark first user interaction
     */
    markFirstInteraction() {
      if (firstUserInteraction === null) {
        firstUserInteraction = (Date.now() - startTime) / 1000;
        console.log(`👆 First user interaction at ${firstUserInteraction.toFixed(2)}s`);
      }
    },

    /**
     * Get all network requests
     */
    getRequests() {
      return networkRequests;
    },

    /**
     * Get tracking requests
     */
    getTrackingRequests() {
      return trackingRequests;
    },

    /**
     * Get tracking requests that occurred before consent
     */
    getTrackingBeforeConsent() {
      return trackingRequests.filter(r => r.beforeConsent);
    },

    /**
     * Get statistics
     */
    getStats() {
      const trackingBeforeConsent = this.getTrackingBeforeConsent();

      return {
        totalRequests: networkRequests.length,
        trackingRequests: trackingRequests.length,
        trackingBeforeConsent: trackingBeforeConsent.length,
        hasTrackingBeforeConsent: trackingBeforeConsent.length > 0,
        pageLoadTime: pageLoadTime,
        firstInteraction: firstUserInteraction
      };
    }
  };
}

/**
 * Check if URL is a tracking request
 * @param {string} url - Request URL
 * @param {string} resourceType - Puppeteer resource type (script, xhr, fetch, image, font, stylesheet, etc.)
 * @returns {boolean} True if tracking request
 */
/**
 * Proper domain suffix matching - prevents false positives from substring matching
 * e.g. matchesDomain("ads.doubleclick.net", "doubleclick.net") = true
 *      matchesDomain("notdoubleclick.net", "doubleclick.net") = false
 */
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

/**
 * Check if hostname belongs to any known tracking domain list
 */
function isKnownTrackingDomain(hostname) {
  const allDomains = [
    ...(TRACKING_DOMAINS.analytics || []),
    ...(TRACKING_DOMAINS.advertising || []),
    ...(TRACKING_DOMAINS.social_media || [])
  ];
  return allDomains.some(d => matchesDomain(hostname, d));
}

function isTrackingRequest(url, resourceType) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();

    // ──────────────────────────────────────────────────────────
    // RULE 0: Resource types that are NEVER tracking violations
    // Fonts, stylesheets, media assets = rendering resources
    // ──────────────────────────────────────────────────────────
    const ALWAYS_BENIGN_TYPES = ['font', 'stylesheet', 'media', 'texttrack', 'manifest'];
    if (ALWAYS_BENIGN_TYPES.includes(resourceType)) {
      return false;
    }

    // ──────────────────────────────────────────────────────────
    // RULE 0b: Images are benign UNLESS they are tracking pixels
    // Tracking pixel = image from tracking domain with tracking path + payload
    // ──────────────────────────────────────────────────────────
    if (resourceType === 'image') {
      if (!isKnownTrackingDomain(hostname)) {
        return false; // Regular content image
      }

      // From tracking domain - only flag if URL has tracking pixel patterns
      const pixelPatterns = ['/tr', '/collect', '/pixel', '/track', '/beacon',
        '/t.gif', '/p.gif', '/b.gif', '/c.gif', '/bat.gif', '/impression',
        '/conversion', '/event'];
      const hasPixelPath = pixelPatterns.some(p => pathname.includes(p));
      const hasQueryPayload = urlObj.search.length > 10;

      // Require both pixel path AND payload for image tracking (stricter)
      return hasPixelPath && hasQueryPayload;
    }

    // ──────────────────────────────────────────────────────────
    // RULE 0c: Exclude content file extensions (static assets)
    // ──────────────────────────────────────────────────────────
    const STATIC_EXTENSIONS = ['.webp', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico',
      '.bmp', '.tiff', '.woff', '.woff2', '.ttf', '.eot', '.otf',
      '.css', '.mp4', '.webm', '.mp3', '.ogg', '.wav', '.avif'];
    const lastDot = pathname.lastIndexOf('.');
    const extension = lastDot !== -1 ? pathname.substring(lastDot) : '';
    if (extension && STATIC_EXTENSIONS.includes(extension)) {
      // Exception: .gif tracking pixels from tracking domains with payload
      if (extension === '.gif' && isKnownTrackingDomain(hostname) && urlObj.search.length > 10) {
        return true;
      }
      return false;
    }

    // ──────────────────────────────────────────────────────────
    // RULE 1-4: Check against known tracking domains + patterns
    // ──────────────────────────────────────────────────────────
    if (isKnownTrackingDomain(hostname)) {
      return true;
    }

    // Check for common tracking patterns in URL path
    const trackingPatterns = [
      '/collect', '/g/collect', '/j/collect', '/r/collect',
      '/analytics', '/tracking', '/pixel', '/beacon',
      '/gtag', '/ga.js', '/analytics.js',
      '/tr', '/track', '/event', '/conversion', '/impression',
      '/measure', '/attribution', '/sync'
    ];

    return trackingPatterns.some(pattern => pathname.includes(pattern));
  } catch (error) {
    return false;
  }
}

/**
 * Get unique tracking domains from requests
 * @param {Array} trackingRequests - Array of tracking requests
 * @returns {Array} Unique domain names
 */
function getUniqueTrackingDomains(trackingRequests) {
  const domains = new Set();
  trackingRequests.forEach(req => {
    if (req.domain) {
      domains.add(req.domain);
    }
  });
  return Array.from(domains);
}

module.exports = {
  setupNetworkMonitoring,
  isTrackingRequest,
  getUniqueTrackingDomains
};
