/**
 * Confirmed Tracking Filter — Single Source of Truth (Layer 3)
 *
 * This module is the ONLY authoritative source for determining which network
 * requests constitute confirmed GDPR-relevant pre-consent tracking violations.
 *
 * Metric hierarchy:
 *   Layer 1 — Raw observational evidence (all captured requests)
 *   Layer 2 — Preliminary detection (confidence ≥40, Category A+B)
 *   Layer 3 — Confirmed violations (confidence ≥70, Category A, pre-consent,
 *              non-benign resource type, non-static extension)
 *
 * Only Layer 3 may be used for:
 *   - Executive summary violation counts
 *   - Legal risk classification
 *   - Compliance determination statements
 *   - GDPR violation assessments
 *
 * GDPR basis: Art. 5(1)(d) accuracy, Art. 5(2) accountability
 */

// Resource types that are never tracking violations (page rendering resources)
const BENIGN_RESOURCE_TYPES = [
  'image', 'font', 'stylesheet', 'media', 'texttrack', 'manifest'
];

// Static file extensions that are never tracking violations
const BENIGN_EXTENSIONS = [
  '.webp', '.svg', '.png', '.jpg', '.jpeg', '.gif',
  '.ico', '.bmp', '.tiff', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.css', '.mp4', '.webm', '.mp3', '.ogg', '.wav', '.avif'
];

// URL path patterns that identify tracking pixels (exception to image exclusion)
const TRACKING_PIXEL_PATHS = [
  '/tr', '/collect', '/pixel', '/track', '/beacon', '/t.gif',
  '/p.gif', '/b.gif', '/c.gif', '/bat.gif', '/impression',
  '/conversion', '/event'
];

/**
 * Determines whether a single request is a confirmed Layer 3 tracking violation.
 * All criteria must pass. Category A (confidence ≥70) is required.
 *
 * @param {Object} req - Network request object
 * @param {Set} catAUrls - Set of URLs categorised as Category A (definite tracking)
 * @param {Set} categorizedUrls - Set of URLs in Category A or B (for fallback)
 * @returns {boolean}
 */
function isConfirmedViolation(req, catAUrls, categorizedUrls) {
  // Must be before consent
  if (!req.beforeConsent) return false;

  // Exclude benign resource types (with tracking pixel exception)
  if (req.resourceType && BENIGN_RESOURCE_TYPES.includes(req.resourceType)) {
    if (req.resourceType === 'image') {
      try {
        const u = new URL(req.url);
        const isPixel = u.search.length > 10 &&
          TRACKING_PIXEL_PATHS.some(p => u.pathname.includes(p));
        if (!isPixel) return false;
      } catch { return false; }
    } else {
      return false;
    }
  }

  // Exclude benign static extensions (with .gif tracking pixel exception)
  try {
    const pathname = new URL(req.url).pathname.toLowerCase();
    const ext = pathname.substring(pathname.lastIndexOf('.'));
    if (BENIGN_EXTENSIONS.includes(ext)) {
      if (ext === '.gif') {
        const u = new URL(req.url);
        if (u.search.length <= 10) return false;
        // Fall through to category check
      } else {
        return false;
      }
    }
  } catch { /* proceed with category check */ }

  // Must be Category A (confidence ≥70) — the legally qualified tier
  if (categorizedUrls.size > 0) {
    return catAUrls.has(req.url);
  }

  // Fallback when no categorisation data is available
  return req.isTracking === true;
}

/**
 * Compute Layer 3 confirmed tracking violations from raw network requests.
 * This is the AUTHORITATIVE count for all compliance determinations.
 *
 * @param {Array} networkRequests - Raw requests from network_requests_json
 * @param {Object|null} requestCategorization - Parsed request_categorization_json
 * @returns {Array} Confirmed violation request objects
 */
function computeConfirmedTrackingViolations(networkRequests, requestCategorization) {
  if (!networkRequests || networkRequests.length === 0) return [];

  const catA = requestCategorization?.categoryA?.requests || [];
  const catB = requestCategorization?.categoryB?.requests || [];
  const catAUrls = new Set(catA.map(r => r.url));
  const categorizedUrls = new Set([...catA, ...catB].map(r => r.url));

  return networkRequests.filter(req =>
    isConfirmedViolation(req, catAUrls, categorizedUrls)
  );
}

/**
 * Build the full three-layer metric hierarchy.
 * Produces the SSOT object consumed by all report section builders.
 *
 * @param {Array} networkRequests - Raw requests from network_requests_json
 * @param {Object|null} requestCategorization - Parsed request_categorization_json
 * @returns {Object} Metric hierarchy: layer1, layer2, layer3, internalControl, funnelExplanation
 */
function buildMetricHierarchy(networkRequests, requestCategorization) {
  const allRequests = networkRequests || [];

  // Layer 1 — Observational evidence
  const n1 = allRequests.length;

  // Layer 2 — Preliminary detection (Category A + B, confidence ≥40)
  const catA = requestCategorization?.categoryA?.requests || [];
  const catB = requestCategorization?.categoryB?.requests || [];
  const n2 = catA.length + catB.length;

  // Layer 3 — Confirmed violations (Category A only, all filters applied)
  const confirmedRequests = computeConfirmedTrackingViolations(allRequests, requestCategorization);
  const n3 = confirmedRequests.length;

  // Internal control metrics — calibration only, not for customer display
  const exposureRate = n1 > 0 ? parseFloat((n3 / n1).toFixed(4)) : 0;
  const detectionPrecision = n2 > 0 ? parseFloat((n3 / n2).toFixed(4)) : 0;

  return {
    layer1: {
      count: n1,
      label: 'Total network activity observed',
      legalStatus: 'Observational — not legally qualified'
    },
    layer2: {
      count: n2,
      label: 'Requests with tracking indicators (preliminary)',
      legalStatus: 'Preliminary detection — not legally confirmed'
    },
    layer3: {
      count: n3,
      label: 'Confirmed pre-consent tracking requests',
      legalStatus: 'Legally qualified — authoritative for compliance determination',
      isAuthoritative: true,
      requests: confirmedRequests
    },
    // Internal control: not rendered in customer-facing report sections
    internalControl: {
      exposureRate,
      exposureRatePct: `${(exposureRate * 100).toFixed(1)}%`,
      detectionPrecision,
      detectionPrecisionPct: `${(detectionPrecision * 100).toFixed(1)}%`,
      _note: 'Internal calibration metrics. Exposure Rate = N3/N1 (% of total activity that are confirmed violations). Detection Precision = N3/N2 (% of preliminary detections that are legally qualified).'
    },
    funnelExplanation:
      `${n1} total network requests were captured during the automated scan ` +
      `(Layer 1 — raw observational data). Of these, ${n2} exhibited tracking ` +
      `characteristics based on multi-layer confidence scoring (Layer 2 — preliminary ` +
      `detection, confidence score ≥40). After applying legal qualification filters — ` +
      `restricting to Category A requests (confidence ≥70%), confirmed pre-consent ` +
      `timing, and excluding benign resource types and static assets — ` +
      `${n3} ${n3 === 1 ? 'request is' : 'requests are'} confirmed as GDPR-relevant ` +
      `pre-consent tracking ${n3 === 1 ? 'violation' : 'violations'} ` +
      `(Layer 3 — legally qualified determination). ` +
      `Only Layer 3 figures are used for compliance determinations in this report.`
  };
}

module.exports = {
  BENIGN_RESOURCE_TYPES,
  BENIGN_EXTENSIONS,
  TRACKING_PIXEL_PATHS,
  computeConfirmedTrackingViolations,
  buildMetricHierarchy
};
