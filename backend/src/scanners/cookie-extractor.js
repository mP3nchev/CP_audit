/**
 * Cookie extraction and categorization
 */

/**
 * Extract all cookies from the page
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Array>} Array of cookie objects
 */
async function extractCookies(page) {
  try {
    const cookies = await page.cookies();

    const enrichedCookies = cookies.map(cookie => {
      return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        expiresFormatted: cookie.expires > 0
          ? new Date(cookie.expires * 1000).toISOString()
          : 'session',
        size: (cookie.name.length + cookie.value.length),
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure || false,
        sameSite: cookie.sameSite || 'None',
        type: cookie.domain.startsWith('.') ? 'third-party' : 'first-party',
        category: categorizeCookie(cookie),
        purpose: identifyPurpose(cookie)
      };
    });

    console.log(`✅ Extracted ${enrichedCookies.length} cookies`);
    return enrichedCookies;
  } catch (error) {
    console.error('❌ Cookie extraction failed:', error.message);
    return [];
  }
}

/**
 * Categorize cookie based on name and domain
 * @param {Object} cookie - Cookie object
 * @returns {string} Category name
 */
function categorizeCookie(cookie) {
  const { name, domain } = cookie;
  const nameLower = name.toLowerCase();

  // Essential cookies
  if (/^(PHPSESSID|JSESSIONID|csrftoken|_session|ASP\.NET_SessionId)$/i.test(name)) {
    return 'essential';
  }

  // Consent/preference cookies
  if (/cookie(consent|notice|banner|preference)|gdpr|ccpa|optanon|OneTrust/i.test(nameLower)) {
    return 'preferences';
  }

  // Analytics cookies
  if (/_ga|_gid|_gat|_hjid|_fbp|matomo|piwik|clicky/i.test(nameLower)) {
    return 'analytics';
  }

  // Advertising cookies
  if (/_gcl|doubleclick|__gads|IDE|test_cookie|fr|tr|ads/i.test(nameLower)) {
    return 'advertising';
  }

  // Social media cookies
  if (/facebook|twitter|linkedin|instagram|youtube|pinterest/i.test(domain)) {
    return 'social_media';
  }

  // Marketing cookies
  if (/hubspot|marketo|pardot|eloqua|mailchimp/i.test(nameLower)) {
    return 'marketing';
  }

  // Default: unknown
  return 'unknown';
}

/**
 * Identify cookie purpose based on patterns
 * @param {Object} cookie - Cookie object
 * @returns {string} Purpose description
 */
function identifyPurpose(cookie) {
  const { name, domain } = cookie;
  const nameLower = name.toLowerCase();

  // Google Analytics
  if (/_ga/.test(nameLower)) {
    return 'Google Analytics tracking';
  }

  // Facebook
  if (/_fbp|fr/.test(nameLower) || domain.includes('facebook')) {
    return 'Facebook tracking pixel';
  }

  // Google Ads
  if (/_gcl|__gads|IDE/.test(nameLower) || domain.includes('doubleclick')) {
    return 'Google Ads tracking';
  }

  // Hotjar
  if (/_hj/.test(nameLower)) {
    return 'Hotjar analytics';
  }

  // Session
  if (/session/i.test(nameLower)) {
    return 'Session management';
  }

  // CSRF
  if (/csrf/i.test(nameLower)) {
    return 'Security (CSRF protection)';
  }

  // Consent
  if (/consent|gdpr|cookie/i.test(nameLower)) {
    return 'Cookie consent preferences';
  }

  return 'Unknown purpose';
}

/**
 * Get cookie statistics
 * @param {Array} cookies - Array of cookies
 * @returns {Object} Statistics object
 */
function getCookieStats(cookies) {
  const stats = {
    total: cookies.length,
    byCategory: {},
    byType: {
      'first-party': 0,
      'third-party': 0
    },
    session: 0,
    persistent: 0,
    secure: 0,
    httpOnly: 0
  };

  cookies.forEach(cookie => {
    // Count by category
    stats.byCategory[cookie.category] = (stats.byCategory[cookie.category] || 0) + 1;

    // Count by type
    stats.byType[cookie.type]++;

    // Count session vs persistent
    if (cookie.expires === -1 || cookie.expiresFormatted === 'session') {
      stats.session++;
    } else {
      stats.persistent++;
    }

    // Count security flags
    if (cookie.secure) stats.secure++;
    if (cookie.httpOnly) stats.httpOnly++;
  });

  return stats;
}

/**
 * Filter cookies by category
 * @param {Array} cookies - Array of cookies
 * @param {string} category - Category to filter by
 * @returns {Array} Filtered cookies
 */
function filterCookiesByCategory(cookies, category) {
  return cookies.filter(c => c.category === category);
}

/**
 * Find tracking cookies (analytics, advertising, marketing)
 * @param {Array} cookies - Array of cookies
 * @returns {Array} Tracking cookies
 */
function findTrackingCookies(cookies) {
  return cookies.filter(c =>
    ['analytics', 'advertising', 'marketing', 'social_media'].includes(c.category)
  );
}

module.exports = {
  extractCookies,
  categorizeCookie,
  identifyPurpose,
  getCookieStats,
  filterCookiesByCategory,
  findTrackingCookies
};
