/**
 * Cookie extraction and categorization
 */

/**
 * Extract all cookies from the page
 * Uses TRIPLE-SOURCE APPROACH for maximum reliability:
 * 1. CDP Storage.getCookies() - Persistent layer (best for JS-set cookies like _ga)
 * 2. CDP Network.getAllCookies() - Transaction layer (HTTP + all contexts)
 * 3. document.cookie - Fallback for JS-accessible cookies
 *
 * @param {Page} page - Puppeteer page
 * @param {Object} options - Options { skipDelay: boolean, delay: number }
 * @returns {Promise<Array>} Array of cookie objects
 */
async function extractCookies(page, options = {}) {
  try {
    // Wait for async cookie setting - Google Analytics (_ga, _gcl_au), Facebook (_fbp, _IDE),
    // Cloudflare (_cfuvid) and other tracking cookies load with delay after page interaction
    // BASELINE snapshot: skipDelay = true (immediate snapshot)
    // FINAL snapshot: skipDelay = false (wait 3s for async cookies)
    const delayMs = options.skipDelay ? 0 : (options.delay || 3000);
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const client = await page.target().createCDPSession();

    // Method 1: CDP Storage.getCookies() - PERSISTENT LAYER (best for _ga, _gcl_au)
    let storageCookies = [];
    try {
      const storageResult = await client.send('Storage.getCookies');
      storageCookies = storageResult.cookies || [];
    } catch (storageError) {
      console.log(`⚠️  Storage.getCookies() failed: ${storageError.message}`);
    }

    // Method 2: CDP Network.getAllCookies() - TRANSACTION LAYER
    let networkCookies = [];
    try {
      const networkResult = await client.send('Network.getAllCookies');
      networkCookies = networkResult.cookies || [];
    } catch (networkError) {
      console.log(`⚠️  Network.getAllCookies() failed: ${networkError.message}`);
    }

    await client.detach();

    // Method 3: document.cookie - FALLBACK for JS-accessible cookies
    const documentCookies = await page.evaluate(() => {
      const cookieString = document.cookie;
      if (!cookieString) return [];

      return cookieString.split(';').map(cookie => {
        const [name, ...valueParts] = cookie.trim().split('=');
        return {
          name: name.trim(),
          value: valueParts.join('=').trim(),
          source: 'document.cookie'
        };
      });
    });

    // MERGE ALL THREE SOURCES (Storage > Network > document.cookie priority)
    const cookieMap = new Map();

    // Priority 1: Storage.getCookies() - most reliable for persistent cookies
    storageCookies.forEach(cookie => {
      cookieMap.set(cookie.name, {
        ...cookie,
        source: 'Storage.getCookies'
      });
    });

    // Priority 2: Network.getAllCookies() - add if not in Storage
    networkCookies.forEach(cookie => {
      if (!cookieMap.has(cookie.name)) {
        cookieMap.set(cookie.name, {
          ...cookie,
          source: 'Network.getAllCookies'
        });
      }
    });

    // Priority 3: document.cookie - final fallback
    documentCookies.forEach(docCookie => {
      if (!cookieMap.has(docCookie.name)) {
        // Construct CDP-like cookie object from document.cookie
        cookieMap.set(docCookie.name, {
          name: docCookie.name,
          value: docCookie.value,
          domain: new URL(page.url()).hostname,
          path: '/',
          expires: -1, // unknown from document.cookie
          httpOnly: false, // accessible from JS
          secure: false, // unknown
          sameSite: 'None',
          source: 'document.cookie'
        });
      }
    });

    const cookies = Array.from(cookieMap.values());

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
        purpose: identifyPurpose(cookie),
        source: cookie.source || 'CDP'
      };
    });

    console.log(`✅ Extracted ${enrichedCookies.length} cookies (Storage: ${storageCookies.length}, Network: ${networkCookies.length}, document: ${documentCookies.length})`);
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
  const domainLower = domain.toLowerCase();

  // Essential cookies
  if (/^(PHPSESSID|JSESSIONID|csrftoken|_session|ASP\.NET_SessionId)$/i.test(name)) {
    return 'essential';
  }

  // Consent/preference cookies
  if (/cookie(consent|notice|banner|preference)|gdpr|ccpa|optanon|OneTrust/i.test(nameLower)) {
    return 'preferences';
  }

  // Analytics cookies (comprehensive list)
  if (/_ga|_gid|_gat|_gac/.test(nameLower) || // Google Analytics
      /_hjid|_hjSession|_hjIncludedInSample/.test(nameLower) || // Hotjar
      /_fbp/.test(nameLower) || // Facebook Pixel
      /clicky|piwik|matomo/.test(nameLower) || // Other analytics
      /^_clck|_clsk/.test(nameLower) || // Microsoft Clarity
      /__hstc|__hssc|hubspotutk/.test(nameLower) || // HubSpot Analytics
      /^s_|mbox|AMCV/.test(name) || // Adobe Analytics
      /^_ym_|_metrika/.test(nameLower) || // Yandex Metrica
      /^vuid|player/.test(nameLower) || // Vimeo
      /^YSC|VISITOR_INFO/.test(name)) { // YouTube Analytics
    return 'analytics';
  }

  // Advertising cookies (comprehensive list)
  if (/_gcl|__gads|IDE|DSID|FLC|AID|TAID|exchange_uid/.test(nameLower) || // Google Ads/DoubleClick
      domainLower.includes('doubleclick') ||
      /^fr$|^tr$|_fbc/.test(nameLower) || // Facebook Ads
      /^li_sugr|bcookie|lidc|UserMatchHistory/.test(nameLower) || // LinkedIn Insight Tag
      /^_ttp|_tt_enable/.test(nameLower) || // TikTok Pixel
      /^_scid|_sctr/.test(nameLower) || // Snapchat Pixel
      /^_pinterest|_pin_unauth/.test(nameLower) || // Pinterest Tag
      /^_rdt_uuid/.test(nameLower) || // Reddit Pixel
      /MUID|_uetsid|_uetvid/.test(name) || // Microsoft/Bing Ads
      /^_fbq|fbssls/.test(nameLower) || // Facebook tracking
      /^__qca|_dlt|mc/.test(nameLower)) { // Quantcast, Oracle, MediaMath
    return 'advertising';
  }

  // Social media cookies
  if (domainLower.includes('facebook') ||
      domainLower.includes('twitter') ||
      domainLower.includes('x.com') ||
      domainLower.includes('linkedin') ||
      domainLower.includes('instagram') ||
      domainLower.includes('youtube') ||
      domainLower.includes('pinterest') ||
      domainLower.includes('tiktok') ||
      domainLower.includes('snapchat') ||
      domainLower.includes('reddit')) {
    return 'social_media';
  }

  // Marketing/CRM cookies
  if (/__hstc|__hssc|__hssrc|hubspotutk|hsfirstvisit/.test(nameLower) || // HubSpot
      /mkto|marketo/.test(nameLower) || // Marketo
      /pardot|visitor_id/.test(nameLower) || // Pardot (Salesforce)
      /eloqua|ELOQUA/.test(name) || // Oracle Eloqua
      /mailchimp|mc_/.test(nameLower) || // Mailchimp
      /_mkto_trk/.test(nameLower) || // Marketo Tracking
      /intercom|drift|_gcl_au/.test(nameLower)) { // Chat/Marketing tools
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
  const domainLower = domain.toLowerCase();

  // Google Analytics
  if (/_ga/.test(nameLower)) return 'Google Analytics - User tracking and behavior analysis';
  if (/_gid/.test(nameLower)) return 'Google Analytics - Session identification';
  if (/_gac/.test(nameLower)) return 'Google Analytics - Campaign tracking';

  // Google Ads / DoubleClick
  if (/_gcl/.test(nameLower)) return 'Google Ads - Conversion tracking';
  if (/__gads|IDE|DSID/.test(nameLower) || domainLower.includes('doubleclick')) {
    return 'Google DoubleClick - Ad targeting and measurement';
  }

  // Facebook
  if (/_fbp/.test(nameLower)) return 'Facebook Pixel - Browser tracking';
  if (/^fr$/.test(nameLower) || domainLower.includes('facebook')) {
    return 'Facebook - Advertising and analytics';
  }

  // Microsoft Clarity
  if (/_clck|_clsk/.test(nameLower)) {
    return 'Microsoft Clarity - Session recording and heatmaps';
  }

  // Microsoft/Bing Ads
  if (/MUID|_uetsid|_uetvid/.test(name)) {
    return 'Microsoft Advertising - Conversion tracking';
  }

  // HubSpot
  if (/__hstc|__hssc|hubspotutk/.test(nameLower)) {
    return 'HubSpot - Visitor tracking and CRM integration';
  }

  // Hotjar
  if (/_hjid|_hjSession/.test(nameLower)) {
    return 'Hotjar - Session recording and analytics';
  }

  // LinkedIn Insight Tag
  if (/li_sugr|bcookie|lidc|UserMatchHistory/.test(nameLower)) {
    return 'LinkedIn - Advertising and analytics';
  }

  // TikTok Pixel
  if (/_ttp|_tt_enable/.test(nameLower)) {
    return 'TikTok Pixel - Advertising and conversion tracking';
  }

  // Snapchat Pixel
  if (/_scid|_sctr/.test(nameLower)) {
    return 'Snapchat Pixel - Advertising analytics';
  }

  // Pinterest Tag
  if (/_pinterest|_pin_unauth/.test(nameLower)) {
    return 'Pinterest Tag - Conversion tracking';
  }

  // Reddit Pixel
  if (/_rdt_uuid/.test(nameLower)) {
    return 'Reddit Pixel - Advertising measurement';
  }

  // Adobe Analytics
  if (/^s_|mbox|AMCV/.test(name)) {
    return 'Adobe Analytics - Visitor tracking and personalization';
  }

  // Marketo
  if (/_mkto_trk|marketo/.test(nameLower)) {
    return 'Marketo - Marketing automation and lead tracking';
  }

  // YouTube
  if (/^YSC|VISITOR_INFO/.test(name)) {
    return 'YouTube - Video analytics and preferences';
  }

  // Matomo/Piwik
  if (/matomo|piwik/.test(nameLower)) {
    return 'Matomo - Privacy-focused analytics';
  }

  // Yandex Metrica
  if (/_ym_|_metrika/.test(nameLower)) {
    return 'Yandex Metrica - Web analytics';
  }

  // Session management
  if (/PHPSESSID|JSESSIONID|ASP\.NET_SessionId|session/i.test(name)) {
    return 'Session management - User authentication and state';
  }

  // CSRF protection
  if (/csrf/i.test(nameLower)) {
    return 'Security - CSRF attack prevention';
  }

  // Consent management
  if (/consent|gdpr|ccpa|cookie/i.test(nameLower)) {
    return 'Cookie consent - User privacy preferences';
  }

  // Intercom/Drift (Chat/Marketing)
  if (/intercom|drift/.test(nameLower)) {
    return 'Live chat and customer engagement';
  }

  return 'Unknown purpose - requires manual review';
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
