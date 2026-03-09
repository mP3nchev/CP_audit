/**
 * Sample network request fixtures for detection-confidence.js tests.
 *
 * Every request object uses EXACT field names from:
 *   - network-monitor.js: url, method, resourceType, timestamp, beforeConsent, isTracking, domain, responseStatus, failed
 *   - detection-confidence.js: pathname, urlObj, vendor, isResource, postData, firedBeforeConsent, pageLoadTimestamp
 *
 * Real domains from tracking-domains.json and vendor-patterns.json.
 */

'use strict';

/**
 * Helper: build an enriched request object matching what detection-confidence expects
 */
function buildRequest(overrides = {}) {
  const url = overrides.url || 'https://example.com/';
  let urlObj;
  try { urlObj = new URL(url); } catch { urlObj = null; }

  return {
    url,
    pathname: urlObj?.pathname || '/',
    urlObj,
    method: 'GET',
    resourceType: 'xhr',
    vendor: null,
    isResource: false,
    responseStatus: 200,
    failed: false,
    postData: null,
    firedBeforeConsent: false,
    timestamp: 0.5,
    pageLoadTimestamp: 0,
    beforeConsent: true,
    isTracking: false,
    headers: {},
    ...overrides
  };
}

// ─── Known Tracking Requests (should score ≥70, Category A) ──────────

const knownTrackingRequests = [
  // 1. Google Analytics /g/collect (GA4 measurement protocol)
  buildRequest({
    url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXXXX&cid=123456.7890&t=pageview&sr=1920x1080&ul=en-us',
    vendor: 'Google Analytics 4',
    resourceType: 'xhr',
    beforeConsent: true,
    firedBeforeConsent: true,
    isTracking: true,
    domain: 'www.google-analytics.com'
  }),

  // 2. Meta Pixel /tr (Facebook tracking pixel)
  buildRequest({
    url: 'https://www.facebook.com/tr?id=123456789&ev=PageView&noscript=1&cd[page_title]=Test',
    vendor: 'Meta Pixel',
    resourceType: 'image',
    beforeConsent: true,
    firedBeforeConsent: true,
    isTracking: true,
    domain: 'www.facebook.com'
  }),

  // 3. Hotjar API call
  buildRequest({
    url: 'https://vc.hotjar.com/api/v2/client/sites/123456/visit-data?sv=7',
    vendor: 'Hotjar',
    resourceType: 'xhr',
    beforeConsent: true,
    firedBeforeConsent: true,
    isTracking: true,
    domain: 'vc.hotjar.com'
  }),

  // 4. DoubleClick /pagead/ (Google Ads)
  buildRequest({
    url: 'https://pagead2.googlesyndication.com/pagead/gen_204?id=tcfe&v=1',
    vendor: 'Google Ads',
    resourceType: 'xhr',
    beforeConsent: true,
    firedBeforeConsent: true,
    isTracking: true,
    domain: 'pagead2.googlesyndication.com'
  }),

  // 5. LinkedIn Insight Tag
  buildRequest({
    url: 'https://px.ads.linkedin.com/collect/?pid=123456&fmt=js&time=1234567890',
    vendor: 'LinkedIn',
    resourceType: 'xhr',
    beforeConsent: true,
    firedBeforeConsent: true,
    isTracking: true,
    domain: 'px.ads.linkedin.com'
  })
];

// ─── Known Benign Requests (should score <40, Category C) ────────────

const knownBenignRequests = [
  // 1. Same-origin CSS file
  buildRequest({
    url: 'https://example.com/style.css',
    resourceType: 'stylesheet',
    isResource: true,
    beforeConsent: false
  }),

  // 2. Google Font file
  buildRequest({
    url: 'https://fonts.gstatic.com/s/roboto/v30/font.woff2',
    resourceType: 'font',
    isResource: true,
    beforeConsent: false
  }),

  // 3. Same-origin API call
  buildRequest({
    url: 'https://example.com/api/products',
    resourceType: 'xhr',
    beforeConsent: false
  }),

  // 4. Same-origin image
  buildRequest({
    url: 'https://example.com/logo.png',
    resourceType: 'image',
    isResource: true,
    beforeConsent: false
  }),

  // 5. CDN JavaScript (non-tracking)
  buildRequest({
    url: 'https://cdnjs.cloudflare.com/ajax/libs/lodash/4.17.21/lodash.min.js',
    resourceType: 'script',
    isResource: true,
    beforeConsent: false
  })
];

// ─── Known Consent Pings (should be identified as consent-only) ──────

const knownConsentPings = [
  // 1. GA4 consent ping with all signals denied (gcs=G100)
  buildRequest({
    url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXXXX&gcs=G100&gcd=11t1t1t1t5&npa=1&dma=1',
    vendor: 'Google Analytics 4',
    resourceType: 'xhr',
    beforeConsent: true,
    firedBeforeConsent: true
  }),

  // 2. GA4 consent ping with gcs=G110
  buildRequest({
    url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXXXX&gcs=G110&gcd=11t1t1&dma_cps=syi&are=1',
    vendor: 'Google Analytics 4',
    resourceType: 'xhr',
    beforeConsent: true,
    firedBeforeConsent: true
  })
];

// ─── Known Blocked Requests (should score low due to failed delivery) ──

const knownBlockedRequests = [
  // 1. Blocked tracking request (ad blocker)
  buildRequest({
    url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXXXX&cid=123',
    vendor: 'Google Analytics 4',
    resourceType: 'xhr',
    responseStatus: 0,
    failed: true,
    beforeConsent: true,
    firedBeforeConsent: true
  }),

  // 2. Blocked Facebook pixel
  buildRequest({
    url: 'https://www.facebook.com/tr?id=999&ev=PageView',
    vendor: 'Meta Pixel',
    resourceType: 'image',
    responseStatus: 0,
    failed: true,
    beforeConsent: true,
    firedBeforeConsent: true
  })
];

module.exports = {
  buildRequest,
  knownTrackingRequests,
  knownBenignRequests,
  knownConsentPings,
  knownBlockedRequests
};
