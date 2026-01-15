/**
 * Timeline Builder - Creates chronological timeline of cookies and tracking requests
 *
 * Shows WHEN cookies were set and tracking requests were made relative to:
 * - Page load
 * - Cookie banner appearance
 * - User consent interaction
 */

/**
 * Build complete audit timeline
 * @param {Object} options - Timeline data
 * @param {Array} options.cookies - Cookies with timestamps
 * @param {Array} options.networkRequests - Network requests with timestamps
 * @param {number} options.pageLoadTime - When page finished loading (ms since navigationStart)
 * @param {number} options.bannerAppearTime - When banner appeared (ms since navigationStart)
 * @param {number} options.consentTime - When user gave consent (ms since navigationStart, optional)
 * @returns {Object} Timeline visualization data
 */
function buildTimeline(options) {
  const {
    cookies = [],
    networkRequests = [],
    pageLoadTime = 0,
    bannerAppearTime = null,
    consentTime = null
  } = options;

  // Create timeline events
  const events = [];

  // Milestone events
  events.push({
    type: 'milestone',
    name: 'Page Load Started',
    timestamp: 0,
    color: 'blue',
    icon: '🚀'
  });

  if (pageLoadTime > 0) {
    events.push({
      type: 'milestone',
      name: 'Page Load Complete',
      timestamp: pageLoadTime,
      color: 'green',
      icon: '✅'
    });
  }

  if (bannerAppearTime !== null) {
    events.push({
      type: 'milestone',
      name: 'Cookie Banner Appeared',
      timestamp: bannerAppearTime,
      color: 'orange',
      icon: '🍪',
      important: true
    });
  }

  if (consentTime !== null) {
    events.push({
      type: 'milestone',
      name: 'User Gave Consent',
      timestamp: consentTime,
      color: 'purple',
      icon: '👤'
    });
  }

  // Cookie events
  cookies.forEach(cookie => {
    if (cookie.detectedAt) {
      const timestamp = cookie.detectedAt;
      const beforeConsent = bannerAppearTime ? timestamp < bannerAppearTime : true;

      events.push({
        type: 'cookie',
        name: cookie.name,
        timestamp: timestamp,
        domain: cookie.domain,
        category: cookie.category,
        purpose: cookie.purpose,
        beforeConsent: beforeConsent,
        violation: beforeConsent && ['analytics', 'advertising', 'marketing'].includes(cookie.category),
        color: beforeConsent ? 'red' : 'green',
        icon: '🍪'
      });
    }
  });

  // Network request events (only tracking requests)
  networkRequests
    .filter(req => req.isTracking)
    .forEach(req => {
      const beforeConsent = bannerAppearTime ? req.timestamp < bannerAppearTime : true;

      events.push({
        type: 'request',
        name: req.url,
        timestamp: req.timestamp,
        method: req.method,
        domain: new URL(req.url).hostname,
        tracker: req.tracker,
        beforeConsent: beforeConsent,
        violation: beforeConsent,
        color: beforeConsent ? 'red' : 'green',
        icon: '📡'
      });
    });

  // Sort events by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  // Calculate statistics
  const stats = calculateTimelineStats(events, bannerAppearTime);

  // Create zones for visualization
  const zones = createTimelineZones(events, bannerAppearTime, consentTime);

  return {
    events,
    zones,
    stats,
    duration_ms: Math.max(...events.map(e => e.timestamp), 0),
    violations: events.filter(e => e.violation)
  };
}

/**
 * Calculate timeline statistics
 * @param {Array} events - Timeline events
 * @param {number} bannerAppearTime - When banner appeared
 * @returns {Object} Statistics
 */
function calculateTimelineStats(events, bannerAppearTime) {
  const cookieEvents = events.filter(e => e.type === 'cookie');
  const requestEvents = events.filter(e => e.type === 'request');

  const beforeBanner = bannerAppearTime !== null
    ? events.filter(e => e.timestamp < bannerAppearTime && (e.type === 'cookie' || e.type === 'request'))
    : [];

  const violations = events.filter(e => e.violation);

  return {
    totalCookies: cookieEvents.length,
    totalRequests: requestEvents.length,
    cookiesBeforeConsent: beforeBanner.filter(e => e.type === 'cookie').length,
    requestsBeforeConsent: beforeBanner.filter(e => e.type === 'request').length,
    totalViolations: violations.length,
    violationTypes: {
      cookies: violations.filter(v => v.type === 'cookie').length,
      requests: violations.filter(v => v.type === 'request').length
    }
  };
}

/**
 * Create timeline zones for visualization
 * @param {Array} events - Timeline events
 * @param {number} bannerAppearTime - When banner appeared
 * @param {number} consentTime - When consent was given
 * @returns {Array} Zone definitions
 */
function createTimelineZones(events, bannerAppearTime, consentTime) {
  const zones = [];
  const maxTime = Math.max(...events.map(e => e.timestamp), 0);

  if (bannerAppearTime === null) {
    // No banner detected - entire timeline is violation zone
    zones.push({
      name: 'No Consent Banner',
      start: 0,
      end: maxTime,
      color: 'red',
      opacity: 0.2,
      description: 'No cookie banner detected - all tracking is non-compliant'
    });
  } else {
    // Before banner = violation zone
    zones.push({
      name: 'Before Consent Request',
      start: 0,
      end: bannerAppearTime,
      color: 'red',
      opacity: 0.3,
      description: 'Tracking before user was asked for consent (VIOLATION)',
      violation: true
    });

    if (consentTime !== null) {
      // Between banner and consent = waiting for user
      zones.push({
        name: 'Awaiting User Consent',
        start: bannerAppearTime,
        end: consentTime,
        color: 'orange',
        opacity: 0.2,
        description: 'Banner shown, waiting for user decision'
      });

      // After consent = allowed zone
      zones.push({
        name: 'After Consent',
        start: consentTime,
        end: maxTime,
        color: 'green',
        opacity: 0.1,
        description: 'User gave consent - tracking allowed'
      });
    } else {
      // Banner shown but no consent recorded
      zones.push({
        name: 'After Banner Shown',
        start: bannerAppearTime,
        end: maxTime,
        color: 'orange',
        opacity: 0.2,
        description: 'Banner shown but consent action not recorded'
      });
    }
  }

  return zones;
}

/**
 * Enrich cookies with detection timestamps
 * @param {Page} page - Puppeteer page
 * @param {Array} cookies - Cookie objects
 * @returns {Promise<Array>} Enriched cookies
 */
async function enrichCookiesWithTimestamps(page, cookies) {
  try {
    // Get page navigation timing
    const timing = await page.evaluate(() => {
      return {
        navigationStart: performance.timing.navigationStart,
        now: performance.now()
      };
    });

    // Enrich cookies with relative timestamps
    const enrichedCookies = cookies.map(cookie => {
      return {
        ...cookie,
        detectedAt: timing.now, // ms since page load started
        detectedAtAbsolute: Date.now()
      };
    });

    return enrichedCookies;
  } catch (error) {
    console.error('Failed to enrich cookies with timestamps:', error.message);
    return cookies;
  }
}

/**
 * Detect when cookie banner appeared
 * @param {Page} page - Puppeteer page
 * @returns {Promise<number|null>} Time when banner appeared (ms since navigationStart)
 */
async function detectBannerAppearTime(page) {
  try {
    const result = await page.evaluate(() => {
      // Common cookie banner selectors
      const bannerSelectors = [
        '[id*="cookie"]',
        '[class*="cookie"]',
        '[id*="consent"]',
        '[class*="consent"]',
        '[role="dialog"][aria-label*="cookie" i]',
        '[id*="gdpr"]',
        '[class*="gdpr"]'
      ];

      for (const selector of bannerSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          // Check if element is visible and looks like a banner
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          if (
            rect.width > 200 &&
            rect.height > 100 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          ) {
            // Banner found! Try to estimate when it appeared
            // For now, return current time - in real scenario we'd use MutationObserver
            return performance.now();
          }
        }
      }

      return null; // No banner found
    });

    return result;
  } catch (error) {
    console.error('Failed to detect banner appear time:', error.message);
    return null;
  }
}

/**
 * Generate timeline report for display
 * @param {Object} timeline - Timeline object from buildTimeline()
 * @returns {Object} Formatted report
 */
function generateTimelineReport(timeline) {
  const { events, zones, stats, violations } = timeline;

  // Group violations by time period
  const violationsByZone = zones.map(zone => {
    const zoneViolations = violations.filter(v =>
      v.timestamp >= zone.start && v.timestamp < zone.end
    );

    return {
      zone: zone.name,
      count: zoneViolations.length,
      items: zoneViolations.map(v => ({
        type: v.type,
        name: v.name.length > 50 ? v.name.substring(0, 50) + '...' : v.name,
        time: `${(v.timestamp / 1000).toFixed(2)}s`,
        category: v.category || v.tracker
      }))
    };
  });

  return {
    summary: {
      totalEvents: events.length,
      totalViolations: stats.totalViolations,
      duration: `${(timeline.duration_ms / 1000).toFixed(2)}s`
    },
    beforeConsent: {
      cookies: stats.cookiesBeforeConsent,
      requests: stats.requestsBeforeConsent,
      total: stats.cookiesBeforeConsent + stats.requestsBeforeConsent
    },
    violationsByZone,
    criticalViolations: violations.filter(v => v.type === 'cookie' || v.beforeConsent)
  };
}

module.exports = {
  buildTimeline,
  enrichCookiesWithTimestamps,
  detectBannerAppearTime,
  generateTimelineReport,
  calculateTimelineStats,
  createTimelineZones
};
