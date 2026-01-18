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
      domain: isTracking ? new URL(request.url()).hostname : undefined
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
 * @param {string} resourceType - Resource type
 * @returns {boolean} True if tracking request
 */
function isTrackingRequest(url, resourceType) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Check against known tracking domains
    const isTracking = TRACKING_DOMAINS.analytics.some(domain => hostname.includes(domain)) ||
                      TRACKING_DOMAINS.advertising.some(domain => hostname.includes(domain)) ||
                      TRACKING_DOMAINS.social_media.some(domain => hostname.includes(domain));

    // Also check for common tracking patterns in URL
    const trackingPatterns = [
      '/analytics',
      '/tracking',
      '/pixel',
      '/collect',
      '/gtag',
      '/ga.js',
      '/analytics.js',
      'facebook.com/tr',
      'google-analytics.com',
      'googletagmanager.com'
    ];

    const hasTrackingPattern = trackingPatterns.some(pattern =>
      url.toLowerCase().includes(pattern)
    );

    return isTracking || hasTrackingPattern;
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
