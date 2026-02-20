/**
 * Detection Confidence Engine
 *
 * 5-layer weighted scoring for network request tracking classification.
 * Replaces binary domain-match logic with probabilistic evidence scoring.
 *
 * Layer weights (sum = 1.0):
 *   L4 Semantic Classification   35% — vendor + endpoint + context
 *   L2 Payload Entropy Analysis  25% — mathematical identity-param detection
 *   L1 HTTP Protocol Patterns    15% — pixel/beacon/GIF patterns
 *   L3 Behavioral Clustering     15% — timing, frequency, pre-consent firing
 *   L5 Fingerprinting Score      10% — browser capability detection
 *
 * Output thresholds:
 *   ≥ 70 → Category A (Definite Tracking — reportable violation)
 *   40-69 → Category B (Suspicious — flagged, lower severity)
 *   < 40  → Category C (Benign — no violation)
 *
 * Legal note: Category A findings are suitable for DPA complaint evidence.
 * Category B requires manual verification before litigation use.
 */

'use strict';

const LAYER_WEIGHTS = {
  L4_SEMANTIC:     0.35,
  L2_ENTROPY:      0.25,
  L1_PROTOCOL:     0.15,
  L3_BEHAVIORAL:   0.15,
  L5_FINGERPRINT:  0.10
};

// ─── Consent Mode params (GA4) — indicate state ping, not data collection ────
const CONSENT_MODE_PARAMS = new Set([
  'gcs', 'gcd', 'npa', 'dma', 'dma_cps', 'are', 'pst'
]);

// GA4 gcs values that mean ALL signals denied → consent-only ping, not a violation
const CONSENT_DENIED_GCS_VALUES = new Set(['G100', 'G110', 'G101', 'G111']);

// ─── Identity-bearing parameter name patterns ─────────────────────────────────
const IDENTITY_PARAM_PATTERNS = [
  /^cid$/i,           // GA4 client ID
  /^uid$/i,           // User ID
  /^_fid$/i,          // GA4 Firebase ID
  /^fbp$/i,           // Facebook Browser Pixel ID
  /^fbc$/i,           // Facebook Click ID
  /^_hjid$/i,         // Hotjar User ID
  /^s_vi$/i,          // Adobe Visitor ID
  /^mid$/i,           // Adobe Marketing Cloud ID
  /^hutk$/i,          // HubSpot tracking cookie
  /^hsfp$/i,          // HubSpot fingerprint
  /^pid$/i,           // LinkedIn / generic pixel ID
  /^msclkid$/i,       // Microsoft Click ID
  /^gclid$/i,         // Google Click ID
  /^wbraid$/i,        // Google web-to-app conversion
  /^ttclid$/i,        // TikTok Click ID
  /^ttp$/i,           // TikTok Pixel persistent ID
  /^epik$/i,          // Pinterest Click ID
  /^scid$/i,          // Snapchat Cookie ID
  /^_ym_uid$/i,       // Yandex UID
  /visitor[_-]?id/i,
  /session[_-]?id/i,
  /anon[_-]?id/i,
  /distinct[_-]?id/i,
  /device[_-]?id/i,
  /client[_-]?id/i,
  /user[_-]?id/i,
  /track(ing)?[_-]?id/i,
  /uuid/i,
  /guid/i
];

// ─── Browser fingerprinting capability parameters ─────────────────────────────
const FINGERPRINT_PARAM_NAMES = new Set([
  'sr',  // screen resolution
  'sd',  // screen color depth
  'ul',  // user language
  'je',  // Java enabled
  'de',  // document encoding
  'vp',  // viewport
  'ua',  // user agent
  'tz',  // timezone
  'pl',  // plugins
  'dnt', // Do Not Track (signals capability profiling)
  's_resolution',
  's_colorDepth',
  'screen_resolution',
  'color_depth',
  'timezone_offset'
]);

// ─── High-confidence tracking endpoint segments ───────────────────────────────
const HIGH_CONFIDENCE_ENDPOINTS = [
  '/collect',              // GA4 / Clarity / generic
  '/g/collect',            // GA4 measurement protocol
  '/j/collect',            // GA4 JS collection
  '/r/collect',            // GA4 real-time
  '/tr',                   // Meta Pixel (exact or subpath)
  '/b/ss/',                // Adobe SiteCatalyst
  '/i18n/pixel/track',     // TikTok
  '/api/v1/pixel/track',   // TikTok alternate
  '/pixel/track.gif',      // TikTok pixel GIF
  '/bat.gif',              // Bing Ads
  '/action/',              // Bing conversion
  '/li/track',             // LinkedIn
  '/conversion',           // LinkedIn conversion
  '/v3/event',             // Pinterest
  '/rdt/',                 // Reddit
  '/dtm_pixel/',           // Reddit alternate
  '/watch/',               // Yandex Metrica
  '/webvisor/',            // Yandex session recording
  '/clmap/',               // Yandex click map
  '/api/v2/client/',       // Hotjar
  '/ptracking',            // YouTube player tracking
  '/api/stats/',           // YouTube stats
  '/generate_204',         // YouTube view beacon
  '/v2.0/events',          // Meta CAPI
  '/v3.0/events',          // Meta CAPI v3
  '/p',                    // Snapchat pixel
  '/track-event',          // HubSpot
  '/v1/track',             // HubSpot alternate
  '/t.gif',                // HubSpot / generic
  '/webevents/',           // Marketo
  '/stats',                // Vimeo stats
  '/log/play'              // Vimeo play log
];

// Generic endpoint segments (lower confidence, require payload evidence)
const GENERIC_TRACKING_ENDPOINTS = [
  '/track', '/pixel', '/beacon', '/analytics',
  '/events', '/conversion', '/impression', '/hit',
  '/ping', '/log', '/telemetry', '/collect'
];

// ─── L4: Semantic Classification ─────────────────────────────────────────────
/**
 * Classifies based on vendor knowledge + endpoint semantics.
 *
 * @param {Object} request  Parsed request with .pathname, .url, .vendor, .isResource
 * @returns {number} Score 0-100
 */
function scoreL4Semantic(request) {
  let score = 0;
  const pathname = (request.pathname || '').toLowerCase();

  const isKnownVendor   = Boolean(request.vendor);
  const isResourceLoad  = request.isResource === true;

  if (isKnownVendor) {
    // Domain matches a known tracking vendor
    score += 20;

    if (isResourceLoad) {
      // Script / stylesheet loading — NOT a tracking action
      return Math.max(0, score - 40);
    }

    // Exact tracking endpoint match
    const matchesHighConf = HIGH_CONFIDENCE_ENDPOINTS.some(ep =>
      pathname === ep ||
      pathname.startsWith(ep) ||
      pathname.includes(ep)
    );
    if (matchesHighConf) {
      score += 55;
    } else {
      // Domain matched but path unknown — moderate signal only
      score += 10;
    }
  } else {
    // Unknown vendor — rely on generic patterns
    const matchesGeneric = GENERIC_TRACKING_ENDPOINTS.some(ep => pathname.includes(ep));
    if (matchesGeneric) score += 30;

    // Tracking pixel file pattern (e.g. /t.gif, /pixel.png?v=1)
    if (/\/(t|p|b|pixel|track|1x1|dot|beacon)\.(gif|png|jpg|svg)(\?|$)/i.test(request.url)) {
      score += 40;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── L2: Payload Entropy Analysis ────────────────────────────────────────────
/**
 * Detects identity-bearing URL params and high-entropy values.
 * Also identifies Consent Mode-only pings (not violations).
 *
 * @param {Object} request  Request with .urlObj (URL instance), .postData
 * @returns {number} Score 0-100, or negative if consent-only ping
 */
function scoreL2Entropy(request) {
  if (!request.urlObj) return 0;

  let score = 0;
  const params = request.urlObj.searchParams;
  const paramKeys = [...params.keys()];

  // ── Consent Mode ping detection (GA4) ──
  const hasConsentParam     = paramKeys.some(k => CONSENT_MODE_PARAMS.has(k));
  const hasNonConsentParam  = paramKeys.some(k =>
    !CONSENT_MODE_PARAMS.has(k) &&
    !['v', 'tid', 't', '_s', 'sr', 'ul', 'de', 'dt', 'dp', 'dh', '_p', 'z', 'tid'].includes(k)
  );

  if (hasConsentParam && !hasNonConsentParam) {
    const gcsValue = params.get('gcs') || '';
    if (CONSENT_DENIED_GCS_VALUES.has(gcsValue)) {
      // Confirmed consent-denied ping — NOT a GDPR violation, push to benign
      return -25;
    }
    // Consent ping with granted values — moderate concern but not definite tracking
    return -10;
  }

  // ── Identity parameter name matching ──
  for (const [key, value] of params.entries()) {
    const isIdentity = IDENTITY_PARAM_PATTERNS.some(p => p.test(key));
    if (isIdentity) {
      score += 25;
    }

    // Shannon entropy of parameter value — high entropy = likely encoded user ID
    if (value && value.length >= 8) {
      const entropy = calculateShannonEntropy(value);
      if (entropy >= 4.0) {
        score += 15;  // Very high entropy (UUID / base64 / hashed ID)
      } else if (entropy >= 3.0) {
        score += 7;
      }
    }
  }

  // ── POST body analysis ──
  if (request.postData && request.postData.length > 5) {
    const body = request.postData;

    // JSON with identity fields
    try {
      const json = JSON.parse(body);
      const flatKeys = flattenObjectKeys(json).join(' ').toLowerCase();
      if (/user_id|client_id|visitor_id|session_id|device_id|distinct_id|anon_id/.test(flatKeys)) {
        score += 30;
      }
    } catch { /* not JSON */ }

    // Base64 encoded payload (possible obfuscation)
    if (/^[A-Za-z0-9+/]{30,}={0,2}$/.test(body.trim())) {
      score += 15;
    }

    // Non-empty POST to known tracking endpoint = payload evidence
    if (body.length > 20) score += 10;
  }

  return Math.max(-25, Math.min(100, score));
}

// ─── L1: HTTP Protocol Patterns ──────────────────────────────────────────────
/**
 * Detects tracking at the HTTP protocol level.
 * Pixel beacons, navigator.sendBeacon(), image GET with query params.
 *
 * @param {Object} request  Request with .method, .resourceType, .url, .responseStatus
 * @returns {number} Score 0-100
 */
function scoreL1Protocol(request) {
  let score = 0;
  const method       = (request.method || 'GET').toUpperCase();
  const resourceType = (request.resourceType || '').toLowerCase();
  const url          = request.url || '';

  // navigator.sendBeacon() POST — definitive tracking transmission
  if (method === 'POST' && resourceType === 'ping') {
    score += 60;
  }

  // Image pixel with query string (1x1 tracking GIF)
  if (/\.(gif|png|jpg)(\?|$)/i.test(url)) {
    const queryLen = url.includes('?') ? url.split('?')[1].length : 0;
    if (queryLen > 20) score += 45;
    else if (queryLen > 5) score += 20;
  }

  // XHR/Fetch POST to external domain
  if (['xhr', 'fetch'].includes(resourceType) && method === 'POST') {
    score += 20;
  }

  // Response status: only successful requests constitute data transmission evidence
  if (typeof request.responseStatus === 'number') {
    if (request.responseStatus >= 200 && request.responseStatus < 400) {
      score += 15;  // Confirmed delivery
    } else if (request.responseStatus >= 400) {
      score -= 20;  // Failed request — data not received, weaker evidence
    }
  }

  // Tiny image resource (common for pixels)
  if (resourceType === 'image' && method === 'GET') {
    const hasQueryParams = url.includes('?') && url.split('?')[1].length > 10;
    if (hasQueryParams) score += 15;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── L3: Behavioral Clustering ───────────────────────────────────────────────
/**
 * Detects tracking patterns based on request timing and frequency.
 *
 * @param {Object} request     Current request
 * @param {Array}  allRequests All requests from the session (for clustering)
 * @returns {number} Score 0-100
 */
function scoreL3Behavioral(request, allRequests) {
  let score = 0;

  // Signal: fired before user gave consent
  if (request.firedBeforeConsent === true) {
    score += 30;
  }

  // Signal: fires very early (< 600ms from page load) = likely beacon
  if (typeof request.timestamp === 'number' && typeof request.pageLoadTimestamp === 'number') {
    const delta = request.timestamp - request.pageLoadTimestamp;
    if (delta >= 0 && delta < 600) {
      score += 20;
    }
  }

  // Signal: same host sends multiple requests (frequency clustering)
  if (Array.isArray(allRequests) && allRequests.length > 0) {
    try {
      const thisHost = new URL(request.url).hostname;
      const sameHostCount = allRequests.filter(r => {
        try { return new URL(r.url).hostname === thisHost; } catch { return false; }
      }).length;

      if (sameHostCount > 10) score += 15;
      else if (sameHostCount > 3) score += 8;
    } catch { /* invalid URL */ }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── L5: Fingerprinting Score ─────────────────────────────────────────────────
/**
 * Detects browser fingerprinting capability signals in URL parameters.
 * Fingerprinting = persistent tracking without cookies (GDPR Art. 5(3) applies).
 *
 * @param {Object} request  Request with .urlObj
 * @returns {number} Score 0-100
 */
function scoreL5Fingerprinting(request) {
  if (!request.urlObj) return 0;

  let score = 0;
  const params = request.urlObj.searchParams;
  let fingerprintCount = 0;

  for (const key of params.keys()) {
    if (FINGERPRINT_PARAM_NAMES.has(key.toLowerCase())) {
      fingerprintCount++;
    }
  }

  // 3+ fingerprinting params = strong signal
  if (fingerprintCount >= 3) score += 65;
  else if (fingerprintCount >= 2) score += 40;
  else if (fingerprintCount >= 1) score += 15;

  return Math.max(0, Math.min(100, score));
}

// ─── Composite Scoring ────────────────────────────────────────────────────────
/**
 * Combines all 5 layer scores into a single confidence score.
 *
 * @param {Object} scores  Individual layer scores {l4, l2, l1, l3, l5}
 * @returns {number} Composite confidence 0-100
 */
function calculateCompositeScore(scores) {
  const {
    l4_semantic    = 0,
    l2_entropy     = 0,
    l1_protocol    = 0,
    l3_behavioral  = 0,
    l5_fingerprint = 0
  } = scores;

  const composite =
    l4_semantic    * LAYER_WEIGHTS.L4_SEMANTIC    +
    l2_entropy     * LAYER_WEIGHTS.L2_ENTROPY     +
    l1_protocol    * LAYER_WEIGHTS.L1_PROTOCOL    +
    l3_behavioral  * LAYER_WEIGHTS.L3_BEHAVIORAL  +
    l5_fingerprint * LAYER_WEIGHTS.L5_FINGERPRINT;

  return Math.round(Math.max(0, Math.min(100, composite)));
}

/**
 * Map composite confidence score to tracking category.
 *
 * @param {number} score  0-100
 * @returns {'A'|'B'|'C'}
 */
function scoreToCategory(score) {
  if (score >= 70) return 'A';
  if (score >= 40) return 'B';
  return 'C';
}

/**
 * Run all 5 layers and return full scoring breakdown.
 *
 * @param {Object} request      Enriched request object
 * @param {Array}  allRequests  All session requests (for L3)
 * @returns {Object} { scores, composite, category, isConsentPing }
 */
function analyzeRequest(request, allRequests = []) {
  const l2_raw = scoreL2Entropy(request);
  const isConsentPing = l2_raw < 0;

  const scores = {
    l4_semantic:    scoreL4Semantic(request),
    l2_entropy:     Math.max(0, l2_raw),  // clamp to 0 for composite
    l1_protocol:    scoreL1Protocol(request),
    l3_behavioral:  scoreL3Behavioral(request, allRequests),
    l5_fingerprint: scoreL5Fingerprinting(request)
  };

  // Consent-only ping overrides all other signals — demote to benign
  if (isConsentPing) {
    return {
      scores,
      composite: 10,
      category: 'C',
      isConsentPing: true,
      reason: 'Google Consent Mode state ping (all signals denied) — not a data collection event'
    };
  }

  const composite = calculateCompositeScore(scores);
  const category  = scoreToCategory(composite);

  return {
    scores,
    composite,
    category,
    isConsentPing: false
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────
/**
 * Calculate Shannon entropy of a string.
 * High entropy (> 3.8) indicates encoded identifiers (UUIDs, base64, hashed IDs).
 *
 * @param {string} str
 * @returns {number} Entropy in bits
 */
function calculateShannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Recursively flatten object keys for identity-field scanning.
 * @param {Object} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function flattenObjectKeys(obj, prefix = '') {
  const keys = [];
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      keys.push(fullKey);
      if (v && typeof v === 'object') {
        keys.push(...flattenObjectKeys(v, fullKey));
      }
    }
  }
  return keys;
}

module.exports = {
  analyzeRequest,
  calculateCompositeScore,
  scoreToCategory,
  scoreL4Semantic,
  scoreL2Entropy,
  scoreL1Protocol,
  scoreL3Behavioral,
  scoreL5Fingerprinting,
  calculateShannonEntropy,
  CONSENT_MODE_PARAMS,
  CONSENT_DENIED_GCS_VALUES,
  LAYER_WEIGHTS
};
