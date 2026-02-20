/**
 * Network Request Categorizer v2
 *
 * Multi-layer confidence scoring replaces binary domain-matching.
 * Integrates detection-confidence.js (L1-L5) for every request.
 *
 * Categories:
 *   A — Definite Tracking   (confidence ≥ 70) — reportable GDPR violation evidence
 *   B — Suspicious          (confidence 40-69) — flagged, needs manual verification
 *   C — Benign              (<40 OR resource load OR consent-ping)
 *
 * Key fixes over v1:
 *   ✓ Removed pure domain-only flagging (was causing 25-35% false positives)
 *   ✓ Added response status check (200-399 = confirmed delivery, 4xx = demote)
 *   ✓ Consent Mode ping differentiation (gcs/gcd params → not a violation)
 *   ✓ 5-layer confidence scoring (L1 protocol, L2 entropy, L3 behavioral,
 *       L4 semantic, L5 fingerprinting)
 *   ✓ Vendor-agnostic generic detection via mathematical + semantic signals
 */

'use strict';

const {
  analyzeRequest,
  CONSENT_MODE_PARAMS
} = require('./detection-confidence');

// ─── Vendor domain + path registry ───────────────────────────────────────────
// Used for L4 Semantic scoring context — NOT for final categorization alone.
// A domain match alone is NO LONGER sufficient to flag as tracking.
const TRACKING_VENDORS = {
  google: {
    domains: [
      'google-analytics.com',
      'googletagmanager.com',
      'doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'google.com'
    ],
    trackingPaths: [
      '/collect', '/g/collect', '/j/collect', '/r/collect',
      '/pagead/conversion', '/pagead/viewthroughconversion',
      '/ads/ga-audiences'
    ],
    resourcePaths: [
      '/gtag/js', '/gtm.js', '/analytics.js', '/ga.js',
      '/recaptcha/', '/recaptcha.js'
    ]
  },

  facebook: {
    domains: ['facebook.com', 'connect.facebook.net', 'facebook.net'],
    trackingPaths: ['/tr', '/tr/', '/v2.0/events', '/v3.0/events'],
    resourcePaths: ['/en_US/fbevents.js', '/signals/config', '/fbevents.js']
  },

  microsoft: {
    domains: [
      'clarity.ms', 'bing.com', 'bat.bing.com',
      'c.clarity.ms', 'clarity.microsoft.com'
    ],
    trackingPaths: ['/c.gif', '/collect', '/bat.gif', '/action/'],
    resourcePaths: ['/clarity.js', '/bing/sdk.js']
  },

  linkedin: {
    domains: ['linkedin.com', 'ads.linkedin.com', 'px.ads.linkedin.com'],
    trackingPaths: ['/collect', '/li/track', '/conversion', '/match'],
    resourcePaths: ['/insight.min.js']
  },

  tiktok: {
    domains: ['analytics.tiktok.com', 'tiktok.com'],
    trackingPaths: ['/i18n/pixel/track', '/api/v1/pixel/track', '/pixel/track.gif'],
    resourcePaths: ['/pixel/sdk.js']
  },

  snapchat: {
    domains: ['sc-static.net', 'tr.snapchat.com'],
    trackingPaths: ['/p', '/track'],
    resourcePaths: ['/snap-pixel.min.js']
  },

  pinterest: {
    domains: ['ct.pinterest.com', 'pinterest.com'],
    trackingPaths: ['/v3/event', '/v3/', '/user/'],
    resourcePaths: ['/pintrk.js']
  },

  reddit: {
    domains: ['reddit.com', 'alb.reddit.com'],
    trackingPaths: ['/rdt/', '/dtm_pixel/'],
    resourcePaths: ['/redditpixel.js']
  },

  hubspot: {
    domains: ['hubspot.com', 'hs-analytics.net', 'hs-scripts.com', 'hsforms.com'],
    trackingPaths: ['/track-event', '/v1/track', '/t.gif'],
    resourcePaths: ['/hs/hsstatic/', '/hubspot.js']
  },

  adobe: {
    domains: ['omtrdc.net', '2o7.net', 'demdex.net'],
    trackingPaths: ['/b/ss/', '/event', '/id'],
    resourcePaths: ['/satellite-', '/AppMeasurement.js']
  },

  hotjar: {
    domains: ['hotjar.com', 'hotjar.io', 'static.hotjar.com'],
    trackingPaths: ['/api/v2/client/', '/client/'],
    resourcePaths: ['/hjmin/', '/static/']
  },

  yandex: {
    domains: ['mc.yandex.ru', 'yandex.ru', 'metrika.yandex.ru'],
    trackingPaths: ['/watch/', '/clmap/', '/webvisor/'],
    resourcePaths: ['/metrika/tag.js']
  },

  youtube: {
    domains: ['youtube.com', 'googlevideo.com'],
    trackingPaths: ['/ptracking', '/api/stats/', '/generate_204'],
    resourcePaths: ['/iframe_api', '/player_api', '/embed/']
  },

  vimeo: {
    domains: ['vimeo.com', 'player.vimeo.com'],
    trackingPaths: ['/stats', '/log/play', '/videoplayback'],
    resourcePaths: ['/player.js', '/embed/']
  },

  marketo: {
    domains: ['marketo.net', 'mktoresp.com'],
    trackingPaths: ['/webevents/', '/track/', '/log/'],
    resourcePaths: ['/munchkin.js']
  }
};

// ─── Suspect TLD fragments (used for unknown-vendor heuristics) ───────────────
const TRACKING_TLD_FRAGMENTS = [
  '.ads.', '.adservice', '.tracking.',
  '.analytics.', '.metrics.', '.telemetry.',
  '.pixel.', '.beacon.'
];

// ─── Main categorization function ─────────────────────────────────────────────
/**
 * Categorize a single network request using 5-layer confidence scoring.
 *
 * @param {Object} request  Raw request: { url, method, headers, postData,
 *                                         responseStatus, resourceType,
 *                                         timestamp, pageLoadTimestamp,
 *                                         firedBeforeConsent, pageUrl }
 * @returns {Object} Categorization result
 */
function categorizeRequest(request, allRequests = []) {
  const url = request.url || '';

  let urlObj, hostname, pathname;
  try {
    urlObj   = new URL(url);
    hostname = urlObj.hostname.toLowerCase();
    pathname = urlObj.pathname.toLowerCase();
  } catch {
    return {
      category: 'C',
      categoryName: 'Benign',
      reason: 'Invalid URL — skipped',
      confidence: 0,
      isTracking: false
    };
  }

  // ── Step 1: Vendor domain + path resolution ──
  let vendorName = null;
  let isResource = false;
  let isKnownTrackingPath = false;

  for (const [name, vendor] of Object.entries(TRACKING_VENDORS)) {
    const matchesDomain = vendor.domains.some(d =>
      hostname === d || hostname.endsWith('.' + d)
    );
    if (!matchesDomain) continue;

    vendorName = name;

    // Check if it's purely a resource/script load
    isResource = vendor.resourcePaths.some(p =>
      pathname.includes(p) || pathname.startsWith(p)
    );

    isKnownTrackingPath = !isResource && vendor.trackingPaths.some(p =>
      pathname === p ||
      pathname.startsWith(p) ||
      pathname.includes(p)
    );

    break; // First vendor match wins
  }

  // ── Step 2: Build enriched request for detection engine ──
  const enriched = {
    ...request,
    url,
    urlObj,
    hostname,
    pathname,
    vendor: vendorName,
    isResource,
    isKnownTrackingPath
  };

  // ── Step 3: Run 5-layer analysis ──
  const analysis = analyzeRequest(enriched, allRequests);

  // ── Step 4: Hard override — resource loads are always benign ──
  if (isResource) {
    return {
      category: 'C',
      categoryName: 'Benign',
      reason: `${vendorName} script/resource loading — not a data collection event`,
      confidence: analysis.composite,
      scores: analysis.scores,
      vendor: vendorName,
      isTracking: false,
      isResource: true
    };
  }

  // ── Step 5: Hard override — consent-only ping ──
  if (analysis.isConsentPing) {
    return {
      category: 'C',
      categoryName: 'Benign',
      reason: analysis.reason,
      confidence: analysis.composite,
      scores: analysis.scores,
      vendor: vendorName,
      isTracking: false,
      isConsentPing: true
    };
  }

  // ── Step 6: Unknown vendor with no tracking signals → benign ──
  if (!vendorName) {
    // Check for suspicious TLD fragment heuristic (weak signal)
    const hasSuspectTLD = TRACKING_TLD_FRAGMENTS.some(f => hostname.includes(f));

    // If composite is below 40 and no suspect TLD → definitely benign
    if (analysis.composite < 40 && !hasSuspectTLD) {
      return {
        category: 'C',
        categoryName: 'Benign',
        reason: 'No tracking signals detected (first-party or CDN resource)',
        confidence: analysis.composite,
        scores: analysis.scores,
        isTracking: false
      };
    }
  }

  // ── Step 7: Map confidence score to category ──
  const { category, composite, scores } = analysis;

  const categoryNames = { A: 'Definite Tracking', B: 'Suspicious', C: 'Benign' };

  const reason = buildReason(category, vendorName, isKnownTrackingPath, enriched, scores);

  return {
    category,
    categoryName: categoryNames[category],
    reason,
    confidence: composite,
    scores,
    vendor: vendorName,
    isTracking: category !== 'C',
    hasPayload: Boolean(
      (url.includes('?') && url.split('?')[1].length > 10) ||
      (request.postData && request.postData.length > 10)
    )
  };
}

/**
 * Build a human-readable reason string for the categorization.
 * Used in report output and audit evidence.
 */
function buildReason(category, vendorName, isKnownTrackingPath, request, scores) {
  const parts = [];

  if (vendorName) parts.push(`${vendorName} vendor`);
  if (isKnownTrackingPath) parts.push('tracking endpoint confirmed');

  if (scores.l2_entropy > 40) parts.push('identity parameters detected in payload');
  if (scores.l1_protocol > 40) parts.push('tracking beacon pattern (pixel/sendBeacon)');
  if (scores.l5_fingerprint > 40) parts.push('browser fingerprinting parameters');
  if (request.firedBeforeConsent) parts.push('fired BEFORE user consent');

  if (typeof request.responseStatus === 'number') {
    if (request.responseStatus >= 200 && request.responseStatus < 400) {
      parts.push(`response ${request.responseStatus} (data confirmed received)`);
    } else if (request.responseStatus >= 400) {
      parts.push(`response ${request.responseStatus} (request failed)`);
    }
  }

  if (parts.length === 0) {
    if (category === 'A') return 'Tracking confirmed by multi-layer analysis';
    if (category === 'B') return 'Suspicious tracking pattern — manual verification recommended';
    return 'No tracking signals — benign request';
  }

  return parts.join('; ');
}

// ─── Bulk categorization ──────────────────────────────────────────────────────
/**
 * Categorize an array of requests with behavioral context (L3 clustering).
 *
 * @param {Array} requests  Array of raw request objects
 * @returns {Object} Summary with categoryA/B/C breakdowns and vendor stats
 */
function categorizeRequests(requests) {
  if (!Array.isArray(requests) || requests.length === 0) {
    return {
      total: 0,
      categoryA: { count: 0, name: 'Definite Tracking', requests: [] },
      categoryB: { count: 0, name: 'Suspicious', requests: [] },
      categoryC: { count: 0, name: 'Benign', requests: [] },
      vendorBreakdown: {},
      trackingRequests: [],
      consentPings: []
    };
  }

  // Pass full request list for L3 behavioral clustering
  const categorized = requests.map(req => ({
    ...req,
    categorization: categorizeRequest(req, requests)
  }));

  const categoryA     = categorized.filter(r => r.categorization.category === 'A');
  const categoryB     = categorized.filter(r => r.categorization.category === 'B');
  const categoryC     = categorized.filter(r => r.categorization.category === 'C');
  const consentPings  = categorized.filter(r => r.categorization.isConsentPing);

  // Vendor breakdown
  const vendorBreakdown = {};
  for (const r of categorized) {
    const vendor = r.categorization.vendor;
    if (!vendor) continue;
    if (!vendorBreakdown[vendor]) {
      vendorBreakdown[vendor] = { total: 0, tracking: 0, resources: 0, consentPings: 0 };
    }
    vendorBreakdown[vendor].total++;
    if (r.categorization.isConsentPing) {
      vendorBreakdown[vendor].consentPings++;
    } else if (r.categorization.isTracking) {
      vendorBreakdown[vendor].tracking++;
    } else {
      vendorBreakdown[vendor].resources++;
    }
  }

  return {
    total: requests.length,
    categoryA: { count: categoryA.length, name: 'Definite Tracking', requests: categoryA },
    categoryB: { count: categoryB.length, name: 'Suspicious', requests: categoryB },
    categoryC: { count: categoryC.length, name: 'Benign', requests: categoryC },
    vendorBreakdown,
    trackingRequests: categorized.filter(r => r.categorization.isTracking),
    consentPings
  };
}

// ─── Report summary ───────────────────────────────────────────────────────────
/**
 * Get a display-ready tracking summary for the report.
 *
 * @param {Object} categorization  Result from categorizeRequests()
 * @returns {Object}
 */
function getTrackingSummary(categorization) {
  const totalTracking = categorization.categoryA.count + categorization.categoryB.count;
  const trackingPct   = categorization.total > 0
    ? ((totalTracking / categorization.total) * 100).toFixed(1)
    : '0.0';

  const topVendors = Object.entries(categorization.vendorBreakdown)
    .sort((a, b) => b[1].tracking - a[1].tracking)
    .slice(0, 5)
    .map(([vendor, data]) => ({
      vendor,
      trackingRequests: data.tracking,
      totalRequests:    data.total,
      consentPings:     data.consentPings
    }));

  return {
    totalRequests:       categorization.total,
    definiteTracking:    categorization.categoryA.count,
    suspiciousTracking:  categorization.categoryB.count,
    benign:              categorization.categoryC.count,
    consentPings:        categorization.consentPings.length,
    trackingPercentage:  parseFloat(trackingPct),
    topTrackingVendors:  topVendors
  };
}

module.exports = {
  categorizeRequest,
  categorizeRequests,
  getTrackingSummary,
  TRACKING_VENDORS
};
