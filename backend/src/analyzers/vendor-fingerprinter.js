/**
 * Vendor Fingerprinting Module
 *
 * Detects specific third-party vendors (GA4, Meta Pixel, TikTok, etc.)
 * based on script URLs, network requests, and global functions.
 *
 * Provides user-friendly vendor names instead of generic domain labels.
 */

const fs = require('fs');
const path = require('path');

// Load vendor patterns
const vendorPatternsPath = path.join(__dirname, '../config/vendor-patterns.json');
const { vendors } = JSON.parse(fs.readFileSync(vendorPatternsPath, 'utf8'));

/**
 * Fingerprint vendors from collected evidence
 *
 * @param {Object} evidence - Evidence collected during page scan
 * @param {Array} evidence.scripts - Loaded script URLs
 * @param {Array} evidence.networkRequests - Network request URLs
 * @param {Array} evidence.globalFunctions - Detected global functions
 * @param {Array} evidence.monitorData - Data from consent monitor (gtag calls, etc.)
 * @returns {Array} Detected vendors with metadata
 */
function fingerprintVendors(evidence) {
  const {
    scripts = [],
    networkRequests = [],
    globalFunctions = [],
    monitorData = {},
    rawCookies = [],
    dataLayerItems = []
  } = evidence;

  const detectedVendors = [];
  const seenVendors = new Set();

  // Check each vendor pattern
  for (const vendor of vendors) {
    const matches = [];
    let confidence = 0;

    // Check script patterns
    for (const pattern of vendor.patterns.filter(p => p.type === 'script')) {
      const regex = new RegExp(pattern.regex, 'i');
      const matchedScripts = scripts.filter(url => regex.test(url));

      if (matchedScripts.length > 0) {
        matches.push({
          type: 'script',
          evidence: matchedScripts[0],
          pattern: pattern.regex
        });
        confidence += 40; // High confidence from script match
      }
    }

    // Check network patterns
    for (const pattern of vendor.patterns.filter(p => p.type === 'network')) {
      const regex = new RegExp(pattern.regex, 'i');
      const matchedRequests = networkRequests.filter(url => regex.test(url));

      if (matchedRequests.length > 0) {
        matches.push({
          type: 'network',
          evidence: matchedRequests[0],
          pattern: pattern.regex
        });
        confidence += 30; // Medium-high confidence from network
      }
    }

    // Check function patterns
    for (const pattern of vendor.patterns.filter(p => p.type === 'function')) {
      if (globalFunctions.includes(pattern.name)) {
        matches.push({
          type: 'function',
          evidence: pattern.name,
          pattern: pattern.name
        });
        confidence += 35; // Medium-high confidence from function
      }
    }

    // Check cookie patterns (+25 confidence)
    for (const pattern of vendor.patterns.filter(p => p.type === 'cookie')) {
      const regex = new RegExp(pattern.regex, 'i');
      const matched = rawCookies.find(c => regex.test(c));
      if (matched) {
        matches.push({ type: 'cookie', evidence: matched.split('=')[0], pattern: pattern.regex });
        confidence += 25;
      }
    }

    // Check dataLayer patterns (+20 confidence)
    for (const pattern of vendor.patterns.filter(p => p.type === 'dataLayer')) {
      const matched = dataLayerItems.find(e => new RegExp(pattern.regex, 'i').test(e.event));
      if (matched) {
        matches.push({ type: 'dataLayer', evidence: matched.event, pattern: pattern.regex });
        confidence += 20;
      }
    }

    // If vendor detected, add to results
    if (matches.length > 0 && !seenVendors.has(vendor.id)) {
      seenVendors.add(vendor.id);

      // Extract timing from monitor data if available
      let firstSeenTimestamp = null;
      let beforeConsent = false;

      // Check gtag calls for this vendor
      if (monitorData.gtagCalls) {
        const vendorGtagCall = monitorData.gtagCalls.find(call => {
          const configId = call.args && call.args[1];
          if (!configId) return false;

          // Check if config ID matches vendor patterns
          if (vendor.id === 'ga4' && /^G-/.test(configId)) return true;
          if (vendor.id === 'google_ads' && /^AW-/.test(configId)) return true;
          return false;
        });

        if (vendorGtagCall) {
          firstSeenTimestamp = vendorGtagCall.timestamp;
          beforeConsent = vendorGtagCall.beforeConsent || false;
        }
      }

      // Check dataLayer events
      if (monitorData.dataLayerEvents && !firstSeenTimestamp) {
        const vendorEvent = monitorData.dataLayerEvents.find(evt => {
          const eventName = evt.event || '';
          return eventName.toLowerCase().includes(vendor.id) ||
                 eventName.toLowerCase().includes(vendor.name.toLowerCase().replace(/\s+/g, '_'));
        });

        if (vendorEvent) {
          firstSeenTimestamp = vendorEvent.timestamp;
          beforeConsent = vendorEvent.beforeConsent || false;
        }
      }

      // Single-layer detections are less reliable — apply 30% confidence penalty
      const detectionLayers = [...new Set(matches.map(m => m.type))];
      if (detectionLayers.length === 1) {
        confidence = Math.round(confidence * 0.7);
      }

      detectedVendors.push({
        id: vendor.id,
        name: vendor.name,
        category: vendor.category,
        gdprRequired: vendor.gdprRequired,
        confidence: Math.min(confidence, 100), // Cap at 100%
        detectionLayers,
        matches: matches.length,
        evidence: matches.slice(0, 3), // Keep first 3 pieces of evidence
        firstSeen: firstSeenTimestamp,
        beforeConsent: beforeConsent,
        violation: beforeConsent && vendor.gdprRequired // GDPR violation if loaded before consent
      });
    }
  }

  // Sort by confidence (highest first)
  detectedVendors.sort((a, b) => b.confidence - a.confidence);

  return detectedVendors;
}

/**
 * Generate vendor compliance summary
 *
 * @param {Array} detectedVendors - Vendors from fingerprintVendors()
 * @param {Object} consentState - Current consent state
 * @returns {Object} Summary with violations and compliant vendors
 */
function generateVendorSummary(detectedVendors, consentState = {}) {
  const summary = {
    total: detectedVendors.length,
    byCategory: {},
    violations: [],
    compliant: [],
    requiresConsent: 0,
    loadedBeforeConsent: 0
  };

  for (const vendor of detectedVendors) {
    // Count by category
    if (!summary.byCategory[vendor.category]) {
      summary.byCategory[vendor.category] = 0;
    }
    summary.byCategory[vendor.category]++;

    // Count consent requirements
    if (vendor.gdprRequired) {
      summary.requiresConsent++;
    }

    // Check violations
    if (vendor.violation) {
      summary.loadedBeforeConsent++;
      summary.violations.push({
        vendor: vendor.name,
        category: vendor.category,
        severity: 'critical',
        message: `${vendor.name} loaded before user consent`,
        evidence: vendor.evidence[0]?.evidence || 'Unknown',
        timestamp: vendor.firstSeen
      });
    } else if (vendor.gdprRequired) {
      summary.compliant.push({
        vendor: vendor.name,
        category: vendor.category,
        loadedAfterConsent: !vendor.beforeConsent
      });
    }
  }

  return summary;
}

/**
 * Extract evidence from page for vendor fingerprinting
 *
 * @param {Object} page - Puppeteer page object
 * @param {Array} networkRequests - Collected network requests
 * @returns {Object} Evidence object
 */
async function extractVendorEvidence(page, networkRequests = []) {
  try {
    // Extract from page context
    const pageEvidence = await page.evaluate(() => {
      const evidence = {
        scripts: [],
        globalFunctions: []
      };

      // Get all script src
      const scriptElements = document.querySelectorAll('script[src]');
      scriptElements.forEach(script => {
        if (script.src) {
          evidence.scripts.push(script.src);
        }
      });

      // Check for common global functions
      const commonFunctions = [
        'gtag', 'ga', 'fbq', '_fbq', 'ttq', 'hj', 'Intercom',
        'analytics', 'mixpanel', 'amplitude', 'clarity',
        'OneTrust', 'Cookiebot', 'grecaptcha', 'Stripe',
        'paypal', 'zE', 'google_tag_manager'
      ];

      for (const funcName of commonFunctions) {
        if (typeof window[funcName] !== 'undefined') {
          evidence.globalFunctions.push(funcName);
        }
      }

      // Also check for nested functions (e.g., window.google_tag_manager)
      if (window.google_tag_manager) {
        evidence.globalFunctions.push('google_tag_manager');
      }

      // Cookie-based detection
      evidence.rawCookies = document.cookie.split(';').map(c => c.trim()).filter(Boolean);

      // dataLayer events (GTM-pushed events indicate vendor presence)
      evidence.dataLayerItems = [];
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.slice(0, 100).forEach(item => {
          if (item && typeof item === 'object' && !Array.isArray(item) && item.event) {
            evidence.dataLayerItems.push({ event: item.event });
          }
        });
      }

      return evidence;
    });

    // Add network requests
    const networkUrls = networkRequests.map(req => req.url || req);

    return {
      scripts: pageEvidence.scripts,
      globalFunctions: pageEvidence.globalFunctions,
      networkRequests: networkUrls,
      rawCookies: pageEvidence.rawCookies || [],
      dataLayerItems: pageEvidence.dataLayerItems || []
    };

  } catch (error) {
    console.error('Failed to extract vendor evidence:', error.message);
    return {
      scripts: [],
      globalFunctions: [],
      networkRequests: [],
      rawCookies: [],
      dataLayerItems: []
    };
  }
}

module.exports = {
  fingerprintVendors,
  generateVendorSummary,
  extractVendorEvidence
};
