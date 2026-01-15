/**
 * Network Request Categorizer
 *
 * Categorizes network requests into:
 * - Category A: Definite tracking (analytics beacons, tracking pixels with payloads)
 * - Category B: Suspicious tracking (third-party from known ad domains)
 * - Category C: Benign (script loading, resources, first-party)
 *
 * Problem 5: Don't limit to Google/Facebook - include comprehensive vendor list
 */

/**
 * Comprehensive tracking vendor patterns
 * Based on real-world GDPR audits and DPA decisions
 */
const TRACKING_VENDORS = {
  // Google ecosystem
  google: {
    domains: [
      'google-analytics.com',
      'googletagmanager.com',
      'doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'google.com/pagead',
      'google.com/ads'
    ],
    trackingPaths: [
      '/collect',        // GA4 & UA collection endpoint
      '/g/collect',      // GA4 measurement protocol
      '/j/collect',      // GA4 JavaScript collection
      '/r/collect',      // GA4 real-time
      '/pagead/conversion',
      '/pagead/viewthroughconversion',
      '/ads/ga-audiences'
    ],
    resourcePaths: [
      '/gtag/js',        // Script loading (benign)
      '/gtm.js',         // Tag Manager script (benign)
      '/analytics.js',   // GA script (benign)
      '/ga.js'           // Legacy GA script (benign)
    ]
  },

  // Facebook/Meta
  facebook: {
    domains: [
      'facebook.com',
      'connect.facebook.net',
      'facebook.net'
    ],
    trackingPaths: [
      '/tr',             // Tracking pixel with events
      '/tr/',
      '/v2.0/events',    // Conversion API
      '/v3.0/events'
    ],
    resourcePaths: [
      '/en_US/fbevents.js',  // Pixel script (benign)
      '/signals/config',     // Configuration (benign)
      '/fbevents.js'
    ]
  },

  // Microsoft ecosystem
  microsoft: {
    domains: [
      'clarity.ms',
      'bing.com',
      'bat.bing.com',
      'c.clarity.ms',
      'clarity.microsoft.com'
    ],
    trackingPaths: [
      '/c.gif',          // Clarity tracking pixel
      '/collect',        // Clarity collection
      '/bat.gif',        // Bing Ads tracking
      '/action/'         // Bing conversion tracking
    ],
    resourcePaths: [
      '/clarity.js',     // Script loading
      '/bing/sdk.js'
    ]
  },

  // LinkedIn
  linkedin: {
    domains: [
      'linkedin.com',
      'ads.linkedin.com',
      'px.ads.linkedin.com'
    ],
    trackingPaths: [
      '/collect',        // LinkedIn Insight Tag
      '/li/track',
      '/conversion',
      '/match'
    ],
    resourcePaths: [
      '/insight.min.js'
    ]
  },

  // TikTok
  tiktok: {
    domains: [
      'analytics.tiktok.com',
      'tiktok.com'
    ],
    trackingPaths: [
      '/i18n/pixel/track',
      '/api/v1/pixel/track',
      '/pixel/track.gif'
    ],
    resourcePaths: [
      '/pixel/sdk.js'
    ]
  },

  // Snapchat
  snapchat: {
    domains: [
      'sc-static.net',
      'tr.snapchat.com'
    ],
    trackingPaths: [
      '/p',              // Pixel tracking
      '/track'
    ],
    resourcePaths: [
      '/snap-pixel.min.js'
    ]
  },

  // Pinterest
  pinterest: {
    domains: [
      'ct.pinterest.com',
      'pinterest.com'
    ],
    trackingPaths: [
      '/v3/event',
      '/v3/',
      '/user/'
    ],
    resourcePaths: [
      '/pintrk.js'
    ]
  },

  // Reddit
  reddit: {
    domains: [
      'reddit.com',
      'alb.reddit.com'
    ],
    trackingPaths: [
      '/rdt/',
      '/dtm_pixel/'
    ],
    resourcePaths: [
      '/redditpixel.js'
    ]
  },

  // HubSpot
  hubspot: {
    domains: [
      'hubspot.com',
      'hs-analytics.net',
      'hs-scripts.com',
      'hsforms.com'
    ],
    trackingPaths: [
      '/track-event',
      '/v1/track',
      '/t.gif'
    ],
    resourcePaths: [
      '/hs/hsstatic/',
      '/hubspot.js'
    ]
  },

  // Adobe Analytics
  adobe: {
    domains: [
      'omtrdc.net',
      '2o7.net',
      'demdex.net'
    ],
    trackingPaths: [
      '/b/ss/',          // SiteCatalyst beacon
      '/event',
      '/id'
    ],
    resourcePaths: [
      '/satellite-',
      '/AppMeasurement.js'
    ]
  },

  // Hotjar
  hotjar: {
    domains: [
      'hotjar.com',
      'hotjar.io',
      'static.hotjar.com'
    ],
    trackingPaths: [
      '/api/v2/client/',
      '/client/'
    ],
    resourcePaths: [
      '/hjmin/',
      '/static/'
    ]
  },

  // Yandex Metrica
  yandex: {
    domains: [
      'mc.yandex.ru',
      'yandex.ru',
      'metrika.yandex.ru'
    ],
    trackingPaths: [
      '/watch/',
      '/clmap/',
      '/webvisor/'
    ],
    resourcePaths: [
      '/metrika/tag.js'
    ]
  },

  // YouTube
  youtube: {
    domains: [
      'youtube.com',
      'googlevideo.com'
    ],
    trackingPaths: [
      '/ptracking',
      '/api/stats/',
      '/generate_204'    // View tracking
    ],
    resourcePaths: [
      '/iframe_api',
      '/player_api',
      '/embed/'
    ]
  },

  // Vimeo
  vimeo: {
    domains: [
      'vimeo.com',
      'player.vimeo.com'
    ],
    trackingPaths: [
      '/stats',
      '/log/play',
      '/videoplayback'
    ],
    resourcePaths: [
      '/player.js',
      '/embed/'
    ]
  },

  // Marketo
  marketo: {
    domains: [
      'marketo.net',
      'mktoresp.com'
    ],
    trackingPaths: [
      '/webevents/',
      '/track/',
      '/log/'
    ],
    resourcePaths: [
      '/munchkin.js'
    ]
  }
};

/**
 * Categorize a network request
 * @param {Object} request - Request object with url, method, timestamp, headers, etc.
 * @returns {Object} Categorization result
 */
function categorizeRequest(request) {
  const url = request.url;
  const urlLower = url.toLowerCase();

  // Parse URL
  let hostname, pathname;
  try {
    const urlObj = new URL(url);
    hostname = urlObj.hostname.toLowerCase();
    pathname = urlObj.pathname.toLowerCase();
  } catch (error) {
    return {
      category: 'C',
      categoryName: 'Benign',
      reason: 'Invalid URL',
      isTracking: false
    };
  }

  // Check against each vendor
  for (const [vendorName, vendor] of Object.entries(TRACKING_VENDORS)) {
    const matchesDomain = vendor.domains.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );

    if (!matchesDomain) {
      continue;
    }

    // Check if it's a resource load (benign)
    const isResource = vendor.resourcePaths.some(path =>
      pathname.includes(path)
    );

    if (isResource) {
      return {
        category: 'C',
        categoryName: 'Benign',
        reason: `${vendorName} script/resource loading`,
        vendor: vendorName,
        isTracking: false
      };
    }

    // Check if it's definite tracking
    const isTracking = vendor.trackingPaths.some(path =>
      pathname.includes(path) || pathname.startsWith(path)
    );

    if (isTracking) {
      // Category A: Definite tracking with payload
      const hasQueryParams = url.includes('?') && url.split('?')[1].length > 10;
      const hasPayload = request.postData && request.postData.length > 10;

      if (hasQueryParams || hasPayload) {
        return {
          category: 'A',
          categoryName: 'Definite Tracking',
          reason: `${vendorName} tracking endpoint with data payload`,
          vendor: vendorName,
          isTracking: true,
          hasPayload: true
        };
      } else {
        return {
          category: 'B',
          categoryName: 'Suspicious',
          reason: `${vendorName} tracking endpoint (no clear payload)`,
          vendor: vendorName,
          isTracking: true,
          hasPayload: false
        };
      }
    }

    // Matched domain but no specific path - suspicious
    return {
      category: 'B',
      categoryName: 'Suspicious',
      reason: `Request to known tracking vendor ${vendorName}`,
      vendor: vendorName,
      isTracking: true
    };
  }

  // Check for generic tracking indicators
  const trackingIndicators = [
    '/collect',
    '/track',
    '/pixel',
    '/beacon',
    '/analytics',
    '/events',
    '/conversion',
    '/impression',
    't.gif',
    'p.gif',
    'b.gif'
  ];

  const hasTrackingIndicator = trackingIndicators.some(indicator =>
    pathname.includes(indicator)
  );

  if (hasTrackingIndicator) {
    return {
      category: 'B',
      categoryName: 'Suspicious',
      reason: 'Generic tracking pattern detected',
      isTracking: true
    };
  }

  // Check if third-party request
  const pageUrl = request.pageUrl || '';
  let pageHostname;
  try {
    pageHostname = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    pageHostname = '';
  }

  const isThirdParty = pageHostname && !hostname.endsWith(pageHostname) && !pageHostname.endsWith(hostname);

  // Known ad/tracking TLDs
  const trackingTLDs = [
    '.ads.',
    '.adservice',
    '.tracking',
    '.analytics',
    '.metrics',
    '.telemetry'
  ];

  const hasTrackingTLD = trackingTLDs.some(tld => hostname.includes(tld));

  if (isThirdParty && hasTrackingTLD) {
    return {
      category: 'B',
      categoryName: 'Suspicious',
      reason: 'Third-party request from tracking-related domain',
      isTracking: true
    };
  }

  // Default: Benign
  return {
    category: 'C',
    categoryName: 'Benign',
    reason: isThirdParty ? 'Third-party resource/CDN' : 'First-party request',
    isTracking: false
  };
}

/**
 * Categorize multiple requests
 * @param {Array} requests - Array of request objects
 * @returns {Object} Categorization summary
 */
function categorizeRequests(requests) {
  const categorized = requests.map(req => ({
    ...req,
    categorization: categorizeRequest(req)
  }));

  const categoryA = categorized.filter(r => r.categorization.category === 'A');
  const categoryB = categorized.filter(r => r.categorization.category === 'B');
  const categoryC = categorized.filter(r => r.categorization.category === 'C');

  const vendorBreakdown = {};
  categorized
    .filter(r => r.categorization.vendor)
    .forEach(r => {
      const vendor = r.categorization.vendor;
      if (!vendorBreakdown[vendor]) {
        vendorBreakdown[vendor] = {
          total: 0,
          tracking: 0,
          resources: 0
        };
      }
      vendorBreakdown[vendor].total++;
      if (r.categorization.isTracking) {
        vendorBreakdown[vendor].tracking++;
      } else {
        vendorBreakdown[vendor].resources++;
      }
    });

  return {
    total: requests.length,
    categoryA: {
      count: categoryA.length,
      name: 'Definite Tracking',
      requests: categoryA
    },
    categoryB: {
      count: categoryB.length,
      name: 'Suspicious',
      requests: categoryB
    },
    categoryC: {
      count: categoryC.length,
      name: 'Benign',
      requests: categoryC
    },
    vendorBreakdown,
    trackingRequests: categorized.filter(r => r.categorization.isTracking)
  };
}

/**
 * Get tracking summary for reporting
 * @param {Object} categorization - Result from categorizeRequests()
 * @returns {Object} Summary for display
 */
function getTrackingSummary(categorization) {
  const totalTracking = categorization.categoryA.count + categorization.categoryB.count;
  const trackingPercentage = ((totalTracking / categorization.total) * 100).toFixed(1);

  const topVendors = Object.entries(categorization.vendorBreakdown)
    .sort((a, b) => b[1].tracking - a[1].tracking)
    .slice(0, 5)
    .map(([vendor, data]) => ({
      vendor,
      trackingRequests: data.tracking,
      totalRequests: data.total
    }));

  return {
    totalRequests: categorization.total,
    definiteTracking: categorization.categoryA.count,
    suspiciousTracking: categorization.categoryB.count,
    benign: categorization.categoryC.count,
    trackingPercentage: parseFloat(trackingPercentage),
    topTrackingVendors: topVendors
  };
}

module.exports = {
  categorizeRequest,
  categorizeRequests,
  getTrackingSummary,
  TRACKING_VENDORS
};
