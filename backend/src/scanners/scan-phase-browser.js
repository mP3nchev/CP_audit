/**
 * Scan Phase: Browser Setup (Steps 1–6.6)
 *
 * Handles browser launch, page creation, monitoring injection,
 * navigation, cookie snapshots, stability waits, consent mode wait,
 * and banner appearance detection.
 *
 * Each step reads from and writes to the shared context object.
 */

const {
  launchBrowser,
  createPage,
  navigateToUrl,
  waitForPageStability
} = require('./puppeteer-setup');

const {
  extractCookies
} = require('./cookie-extractor');

const {
  setupNetworkMonitoring
} = require('./network-monitor');

const {
  injectTrackingDetector
} = require('./tracking-detector');

const {
  getWrapperInjectionScript
} = require('../analyzers/consent-monitor');

const {
  detectBannerAppearTime
} = require('../analyzers/timeline-builder');

const { createLogger } = require('../utils/logger');

const logger = createLogger('phase-browser');

// ─── Step 1: Browser Launch ────────────────────────────────────────
const stepBrowserLaunch = {
  name: 'stepBrowserLaunch',
  stepNumber: '1',
  critical: true,
  async execute(context) {
    logger.debug('scan-substep-start', { substep: 'launch-browser', auditId: context.auditId });
    context.browser = await launchBrowser();

    logger.debug('scan-substep-start', { substep: 'create-page', auditId: context.auditId });
    context.page = await createPage(context.browser);

    // Capture browser console for CMP diagnostics
    context.page.on('console', msg => {
      const text = msg.text();
      if (text.includes('consent') || text.includes('CookieScript') ||
          text.includes('google_tag') || text.includes('ics')) {
        logger.debug('browser-console-message', { type: msg.type(), message: text, auditId: context.auditId });
      }
    });
  }
};

// ─── Step 1 cont: Inject Monitoring ────────────────────────────────
const stepInjectMonitoring = {
  name: 'stepInjectMonitoring',
  stepNumber: '1.1',
  critical: false,
  async execute(context) {
    // Setup network monitoring
    context.networkMonitor = setupNetworkMonitoring(context.page);

    // Inject consent monitor wrappers BEFORE any scripts load
    try {
      const wrapperScript = getWrapperInjectionScript();
      await context.page.evaluateOnNewDocument(wrapperScript);
      logger.debug('scan-substep-complete', { substep: 'consent-monitor-wrappers-injected', auditId: context.auditId });
    } catch (error) {
      logger.error('consent-monitor-injection-failed', {
        error: error.message,
        auditId: context.auditId,
        stack: error.stack
      });
    }

    // Inject tracking detector BEFORE navigation
    await injectTrackingDetector(context.page);
  }
};

// ─── Step 1 cont: Navigate ─────────────────────────────────────────
const stepNavigate = {
  name: 'stepNavigate',
  stepNumber: '1.2',
  critical: true,
  async execute(context) {
    logger.debug('scan-substep-start', { substep: 'navigation', url: context.websiteUrl, auditId: context.auditId });
    await navigateToUrl(context.page, context.websiteUrl);
    context.networkMonitor.markPageLoaded();
    logger.debug('scan-substep-complete', { substep: 'navigation', auditId: context.auditId });
  }
};

// ─── Step 5.5: Immediate Cookie Snapshot ───────────────────────────
const stepImmediateCookieSnapshot = {
  name: 'stepImmediateCookieSnapshot',
  stepNumber: '5.5',
  critical: false,
  async execute(context) {
    context.baselineCookies = await extractCookies(context.page, { skipDelay: true });
    context.baselineTime = await context.page.evaluate(() => performance.now());
    logger.debug('scan-baseline-snapshot', {
      cookieCount: context.baselineCookies.length,
      timeSeconds: (context.baselineTime / 1000).toFixed(2),
      auditId: context.auditId
    });
  }
};

// ─── Step 5.7: Async Cookie Wait ──────────────────────────────────
const stepAsyncCookieWait = {
  name: 'stepAsyncCookieWait',
  stepNumber: '5.7',
  critical: false,
  async execute(context) {
    // Wait 5s for _ga, _gcl_au to load
    await new Promise(resolve => setTimeout(resolve, 5000));
    context.intermediateCookies = await extractCookies(context.page, { skipDelay: true });
    context.intermediateTime = await context.page.evaluate(() => performance.now());
    logger.debug('scan-progress', {
      message: `Intermediate snapshot: ${context.intermediateCookies.length} cookies at ${(context.intermediateTime / 1000).toFixed(2)}s`,
      auditId: context.auditId
    });
  }
};

// ─── Step 6: Page Stability ────────────────────────────────────────
const stepPageStability = {
  name: 'stepPageStability',
  stepNumber: '6',
  critical: false,
  async execute(context) {
    await waitForPageStability(context.page, 3000);
  }
};

// ─── Step 6.6: Consent Mode Wait ──────────────────────────────────
const stepConsentModeWait = {
  name: 'stepConsentModeWait',
  stepNumber: '6.6',
  critical: false,
  async execute(context) {
    let consentReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 15s max wait (500ms * 30)

    while (!consentReady && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));

      const debugData = await context.page.evaluate(() => {
        if (!window.google_tag_data?.ics?.entries) return null;

        const entries = window.google_tag_data.ics.entries;
        const params = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

        const snapshot = {
          timestamp: Date.now(),
          perfTime: performance.now(),
          entries: {}
        };

        params.forEach(param => {
          if (entries[param]) {
            snapshot.entries[param] = {
              default: entries[param].default,
              update: entries[param].update
            };
          }
        });

        return snapshot;
      });

      if (debugData && attempts % 4 === 0) {
        logger.debug('consent-mode-wait-progress', {
          attempt: attempts,
          perfTimeMs: debugData.perfTime.toFixed(0),
          entries: debugData.entries,
          auditId: context.auditId
        });
      }

      consentReady = await context.page.evaluate(() => {
        if (!window.google_tag_data?.ics?.entries) return false;

        const entries = window.google_tag_data.ics.entries;
        const params = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

        const hasAtLeastOneParam = params.some(param => {
          const entry = entries[param];
          if (!entry) return false;

          const value = entry.default;
          if (value === undefined || value === null) return false;
          if (value === 'not_set') return false;
          if (typeof value === 'boolean') return true;
          if (value === 'denied' || value === 'granted') return true;
          return false;
        });

        return hasAtLeastOneParam;
      });

      attempts++;
    }

    if (consentReady) {
      logger.debug('scan-progress', { message: `Consent Mode initialized after ${attempts * 500}ms`, auditId: context.auditId });
    } else {
      logger.debug('scan-progress', { message: `Consent Mode not initialized after ${maxAttempts * 500}ms - proceeding anyway`, auditId: context.auditId });
    }
  }
};

// ─── Step 6.5: Banner Detection ───────────────────────────────────
const stepBannerDetection = {
  name: 'stepBannerDetection',
  stepNumber: '6.5',
  critical: false,
  async execute(context) {
    context.bannerAppearTime = await detectBannerAppearTime(context.page);
    if (context.bannerAppearTime) {
      logger.debug('scan-progress', {
        message: `Cookie banner detected at ${(context.bannerAppearTime / 1000).toFixed(2)}s after page load`,
        auditId: context.auditId
      });
    }
  }
};

// Export ordered step array
const browserSteps = [
  stepBrowserLaunch,
  stepInjectMonitoring,
  stepNavigate,
  stepImmediateCookieSnapshot,
  stepAsyncCookieWait,
  stepPageStability,
  stepConsentModeWait,
  stepBannerDetection
];

module.exports = {
  browserSteps,
  stepBrowserLaunch,
  stepInjectMonitoring,
  stepNavigate,
  stepImmediateCookieSnapshot,
  stepAsyncCookieWait,
  stepPageStability,
  stepConsentModeWait,
  stepBannerDetection
};
