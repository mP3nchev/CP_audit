/**
 * Consent Monitor - Wrapper Injection for Real-time Consent Tracking
 *
 * Injects JavaScript wrappers BEFORE page scripts load to monitor:
 * - gtag('consent', ...) calls (default vs update, timing, states)
 * - dataLayer.push() events (page_view, config, etc.)
 * - localStorage/sessionStorage writes (user IDs, tracking data)
 *
 * All data is logged to window.__consentMonitor for later extraction.
 *
 * Risk mitigation:
 * - Try-catch around all wrappers (fail-safe)
 * - Non-invasive (only logs, doesn't block)
 * - Preserves original function behavior
 */

/**
 * Get wrapper injection script
 *
 * This script is injected via page.evaluateOnNewDocument()
 * BEFORE any third-party scripts load.
 *
 * @returns {string} JavaScript code to inject
 */
function getWrapperInjectionScript() {
  return `
(function() {
  'use strict';

  // Initialize monitoring object
  window.__consentMonitor = {
    gtagCalls: [],
    dataLayerEvents: [],
    storageWrites: [],
    errors: [],
    consentState: {
      ad_storage: 'unknown',
      analytics_storage: 'unknown',
      ad_user_data: 'unknown',
      ad_personalization: 'unknown'
    },
    consentGiven: false,
    consentTimestamp: null,
    startTime: Date.now()
  };

  const monitor = window.__consentMonitor;

  // Helper: Get timestamp relative to page load
  function getTimestamp() {
    return Date.now() - monitor.startTime;
  }

  // Helper: Check if consent was given
  function hasConsent() {
    return monitor.consentGiven;
  }

  // ========================================
  // WRAPPER 1: gtag() function
  // ========================================
  (function wrapGtag() {
    try {
      // Create wrapper function
      const gtagWrapper = function(...args) {
        const timestamp = getTimestamp();
        const beforeConsent = !hasConsent();

        // Log call
        monitor.gtagCalls.push({
          type: args[0], // 'consent', 'config', 'event', etc.
          args: args,
          timestamp: timestamp,
          beforeConsent: beforeConsent,
          consentState: { ...monitor.consentState }
        });

        // Special handling for consent commands
        if (args[0] === 'consent') {
          const command = args[1]; // 'default' or 'update'
          const values = args[2] || {};

          if (command === 'default') {
            // Update consent state from default
            Object.assign(monitor.consentState, values);
          } else if (command === 'update') {
            // Update consent state from update
            Object.assign(monitor.consentState, values);

            // Check if consent was granted
            const hasAnyGranted = Object.values(values).some(v => v === 'granted');
            if (hasAnyGranted && !monitor.consentGiven) {
              monitor.consentGiven = true;
              monitor.consentTimestamp = timestamp;
            }
          }
        }

        // Call original gtag if it exists
        if (typeof window.__originalGtag === 'function') {
          return window.__originalGtag.apply(this, args);
        } else if (typeof window.gtag === 'function' && window.gtag !== gtagWrapper) {
          return window.gtag.apply(this, args);
        } else {
          // gtag not loaded yet, queue the call
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push(arguments);
        }
      };

      // Override gtag
      if (typeof window.gtag !== 'undefined') {
        window.__originalGtag = window.gtag;
      }
      window.gtag = gtagWrapper;

      // Also override via property descriptor for extra safety
      Object.defineProperty(window, 'gtag', {
        get: function() { return gtagWrapper; },
        set: function(fn) {
          window.__originalGtag = fn;
        },
        configurable: true
      });

    } catch (error) {
      monitor.errors.push({
        wrapper: 'gtag',
        error: error.message,
        timestamp: getTimestamp()
      });
    }
  })();

  // ========================================
  // WRAPPER 2: dataLayer.push()
  // ========================================
  (function wrapDataLayer() {
    try {
      // Initialize dataLayer if not exists
      window.dataLayer = window.dataLayer || [];

      // Save original push
      const originalPush = window.dataLayer.push;

      // Create wrapper
      const pushWrapper = function(...args) {
        const timestamp = getTimestamp();
        const beforeConsent = !hasConsent();

        // Log each argument (GTM can push multiple objects)
        for (const item of args) {
          monitor.dataLayerEvents.push({
            event: item.event || item[0] || 'unknown',
            data: item,
            timestamp: timestamp,
            beforeConsent: beforeConsent,
            consentState: { ...monitor.consentState }
          });

          // Check for consent-related events
          if (Array.isArray(item) && item[0] === 'consent') {
            const command = item[1];
            const values = item[2] || {};

            if (command === 'update') {
              Object.assign(monitor.consentState, values);
              const hasAnyGranted = Object.values(values).some(v => v === 'granted');
              if (hasAnyGranted && !monitor.consentGiven) {
                monitor.consentGiven = true;
                monitor.consentTimestamp = timestamp;
              }
            }
          }
        }

        // Call original push
        return originalPush.apply(this, args);
      };

      // Override dataLayer.push
      window.dataLayer.push = pushWrapper;

      // Intercept future dataLayer reassignments
      let _dataLayer = window.dataLayer;
      Object.defineProperty(window, 'dataLayer', {
        get: function() { return _dataLayer; },
        set: function(newValue) {
          if (Array.isArray(newValue)) {
            // Preserve wrapper
            _dataLayer = newValue;
            _dataLayer.push = pushWrapper;
          } else {
            _dataLayer = newValue;
          }
        },
        configurable: true
      });

    } catch (error) {
      monitor.errors.push({
        wrapper: 'dataLayer',
        error: error.message,
        timestamp: getTimestamp()
      });
    }
  })();

  // ========================================
  // WRAPPER 3: localStorage.setItem()
  // ========================================
  (function wrapLocalStorage() {
    try {
      const originalSetItem = localStorage.setItem;
      const originalRemoveItem = localStorage.removeItem;

      localStorage.setItem = function(key, value) {
        const timestamp = getTimestamp();
        const beforeConsent = !hasConsent();

        monitor.storageWrites.push({
          type: 'localStorage',
          action: 'set',
          key: key,
          valueLength: (value || '').length,
          timestamp: timestamp,
          beforeConsent: beforeConsent,
          consentState: { ...monitor.consentState }
        });

        return originalSetItem.apply(this, arguments);
      };

      localStorage.removeItem = function(key) {
        const timestamp = getTimestamp();

        monitor.storageWrites.push({
          type: 'localStorage',
          action: 'remove',
          key: key,
          timestamp: timestamp,
          beforeConsent: !hasConsent()
        });

        return originalRemoveItem.apply(this, arguments);
      };

    } catch (error) {
      monitor.errors.push({
        wrapper: 'localStorage',
        error: error.message,
        timestamp: getTimestamp()
      });
    }
  })();

  // ========================================
  // WRAPPER 4: sessionStorage.setItem()
  // ========================================
  (function wrapSessionStorage() {
    try {
      const originalSetItem = sessionStorage.setItem;
      const originalRemoveItem = sessionStorage.removeItem;

      sessionStorage.setItem = function(key, value) {
        const timestamp = getTimestamp();
        const beforeConsent = !hasConsent();

        monitor.storageWrites.push({
          type: 'sessionStorage',
          action: 'set',
          key: key,
          valueLength: (value || '').length,
          timestamp: timestamp,
          beforeConsent: beforeConsent,
          consentState: { ...monitor.consentState }
        });

        return originalSetItem.apply(this, arguments);
      };

      sessionStorage.removeItem = function(key) {
        const timestamp = getTimestamp();

        monitor.storageWrites.push({
          type: 'sessionStorage',
          action: 'remove',
          key: key,
          timestamp: timestamp,
          beforeConsent: !hasConsent()
        });

        return originalRemoveItem.apply(this, arguments);
      };

    } catch (error) {
      monitor.errors.push({
        wrapper: 'sessionStorage',
        error: error.message,
        timestamp: getTimestamp()
      });
    }
  })();

  // Success marker
  monitor._initialized = true;
  console.log('[ConsentMonitor] Wrappers initialized successfully');

})();
  `.trim();
}

/**
 * Extract monitoring data from page
 *
 * Call this AFTER page load to retrieve all logged data
 *
 * @param {Object} page - Puppeteer page object
 * @returns {Object} Monitoring data
 */
async function extractMonitoringData(page) {
  try {
    const data = await page.evaluate(() => {
      if (!window.__consentMonitor) {
        return null;
      }

      return {
        gtagCalls: window.__consentMonitor.gtagCalls || [],
        dataLayerEvents: window.__consentMonitor.dataLayerEvents || [],
        storageWrites: window.__consentMonitor.storageWrites || [],
        errors: window.__consentMonitor.errors || [],
        consentState: window.__consentMonitor.consentState || {},
        consentGiven: window.__consentMonitor.consentGiven || false,
        consentTimestamp: window.__consentMonitor.consentTimestamp,
        initialized: window.__consentMonitor._initialized || false
      };
    });

    if (!data) {
      console.warn('[ConsentMonitor] No monitoring data found - wrappers may not have initialized');
      return {
        gtagCalls: [],
        dataLayerEvents: [],
        storageWrites: [],
        errors: [],
        initialized: false
      };
    }

    return data;

  } catch (error) {
    console.error('[ConsentMonitor] Failed to extract data:', error.message);
    return {
      gtagCalls: [],
      dataLayerEvents: [],
      storageWrites: [],
      errors: [{ message: error.message }],
      initialized: false
    };
  }
}

/**
 * Analyze monitoring data for violations
 *
 * @param {Object} monitorData - Data from extractMonitoringData()
 * @returns {Object} Analysis results with violations
 */
function analyzeMonitoringData(monitorData) {
  const violations = [];
  const warnings = [];

  // Check gtag calls
  for (const call of monitorData.gtagCalls || []) {
    // Violation: consent 'default' with 'granted' values
    if (call.type === 'consent' && call.args[1] === 'default') {
      const values = call.args[2] || {};
      const grantedParams = Object.entries(values).filter(([k, v]) => v === 'granted');

      if (grantedParams.length > 0) {
        violations.push({
          type: 'consent_default_granted',
          severity: 'critical',
          message: `gtag('consent', 'default') sets ${grantedParams.map(([k]) => k).join(', ')} to 'granted' - violates GDPR`,
          evidence: { call: call.args, timestamp: call.timestamp },
          gdprArticle: 'Article 7(1) - Consent must be freely given'
        });
      }
    }

    // Warning: gtag config/event before consent
    if (call.beforeConsent && (call.type === 'config' || call.type === 'event')) {
      warnings.push({
        type: 'tracking_before_consent',
        severity: 'high',
        message: `gtag('${call.type}') called ${call.timestamp}ms BEFORE consent`,
        evidence: { call: call.args, timestamp: call.timestamp }
      });
    }
  }

  // Check dataLayer events
  for (const event of monitorData.dataLayerEvents || []) {
    // Violation: page_view before consent
    if (event.beforeConsent && event.event === 'page_view') {
      violations.push({
        type: 'pageview_before_consent',
        severity: 'critical',
        message: `page_view event fired ${event.timestamp}ms BEFORE consent`,
        evidence: { event: event.data, timestamp: event.timestamp }
      });
    }

    // Warning: any event before consent
    if (event.beforeConsent && event.event && event.event !== 'gtm.js') {
      warnings.push({
        type: 'event_before_consent',
        severity: 'medium',
        message: `Event '${event.event}' fired ${event.timestamp}ms before consent`,
        evidence: { event: event.event, timestamp: event.timestamp }
      });
    }
  }

  // Check storage writes
  for (const write of monitorData.storageWrites || []) {
    // Violation: user ID or analytics ID before consent
    const suspiciousKeys = ['_ga', '_gid', 'uid', 'user_id', 'visitor_id', 'analytics', 'tracking'];
    const isSuspicious = suspiciousKeys.some(key => write.key.toLowerCase().includes(key));

    if (write.beforeConsent && isSuspicious) {
      violations.push({
        type: 'storage_tracking_before_consent',
        severity: 'critical',
        message: `${write.type} write to '${write.key}' ${write.timestamp}ms BEFORE consent`,
        evidence: { key: write.key, type: write.type, timestamp: write.timestamp },
        gdprArticle: 'ePrivacy Directive Article 5(3)'
      });
    }
  }

  return {
    violations: violations,
    warnings: warnings,
    summary: {
      totalViolations: violations.length,
      totalWarnings: warnings.length,
      criticalViolations: violations.filter(v => v.severity === 'critical').length,
      gtagCallsBeforeConsent: (monitorData.gtagCalls || []).filter(c => c.beforeConsent).length,
      dataLayerEventsBeforeConsent: (monitorData.dataLayerEvents || []).filter(e => e.beforeConsent).length,
      storageWritesBeforeConsent: (monitorData.storageWrites || []).filter(w => w.beforeConsent).length
    }
  };
}

module.exports = {
  getWrapperInjectionScript,
  extractMonitoringData,
  analyzeMonitoringData
};
