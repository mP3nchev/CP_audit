/**
 * Scan Phase: Finalize (Steps 14–17)
 *
 * Handles database persistence, browser close, consent simulation,
 * and compliance scoring.
 *
 * Each step reads from and writes to the shared context object.
 *
 * NOTE: stepPersistScanResults calls saveScanResults() which remains
 * in website-scanner.js until the cutover (Commit 5c). During the
 * cutover, saveScanResults(context) will be called directly.
 */

const {
  closeBrowser
} = require('./puppeteer-setup');

const {
  runAssistedConsentSimulation
} = require('./consent-simulator-v1');

const {
  calculateOverallScore
} = require('../analyzers/compliance-score-calculator');

const { getDatabase } = require('../database/db');
const constants = require('../config/constants');
const { createLogger } = require('../utils/logger');

const logger = createLogger('phase-finalize');

// ─── Step 14: Persist Scan Results ────────────────────────────────
const stepPersistScanResults = {
  name: 'stepPersistScanResults',
  stepNumber: '14',
  critical: true,
  async execute(context) {
    // Build the results object that saveScanResults expects
    // This will be replaced by direct context usage after Commit 5a
    const { saveScanResults } = require('./website-scanner');

    const results = {
      cookies: context.cookies,
      cookieStats: context.cookieStats,
      trackingCookies: context.trackingCookies,
      networkRequests: context.networkMonitor.getRequests(),
      trackingRequests: context.trackingRequests,
      trackingBeforeConsent: context.trackingAnalysis?.trackingBeforeConsent || false,
      trackingBeforeConsentDetails: context.trackingAnalysis,
      trackingBeforeConsentDetailed: buildTrackingBeforeConsentDetailed(context),
      trackingBeforeConsentCount: context.trackingBeforeConsentRequests.length + (context.trackingAnalysis?.violationCount || 0),
      bannerViolations: context.bannerAnalysis?.violations || [],
      bannerAnalysis: context.bannerAnalysis,
      consentModeAudit: context.consentModeAudit,
      monitoringData: context.monitoringData,
      monitoringAnalysis: context.monitoringAnalysis,
      detectedVendors: context.detectedVendors,
      vendorSummary: context.vendorSummary,
      timeline: context.timeline,
      timelineReport: context.timelineReport,
      requestCategorization: context.requestCategorization,
      trackingSummary: context.trackingSummary,
      networkStorageCorrelations: context.networkStorageCorrelations,
      screenshots: {
        full: context.screenshotUrls.fullPageUrl,
        banner: context.screenshotUrls.bannerUrl
      },
      metadata: context.metadata,
      scanDuration: Math.round((Date.now() - context.startTime) / 1000)
    };

    await saveScanResults(context.auditId, results);
  }
};

// ─── Step 15: Close Browser ───────────────────────────────────────
const stepCloseBrowser = {
  name: 'stepCloseBrowser',
  stepNumber: '15',
  critical: false,
  async execute(context) {
    if (context.browser) {
      await closeBrowser(context.browser);
      context.browser = null;
    }
  }
};

// ─── Step 16: Consent Simulation ──────────────────────────────────
const stepConsentSimulation = {
  name: 'stepConsentSimulation',
  stepNumber: '16',
  critical: false,
  async execute(context) {
    if (process.env.SKIP_CONSENT_CHECK === 'true') {
      context.consentSimulation = { skipped: true, reason: 'SKIP_CONSENT_CHECK=true' };
      return;
    }

    try {
      const consentSimulation = await runAssistedConsentSimulation(context.websiteUrl, context.auditId);

      if (consentSimulation.waiting) {
        logger.info('consent-simulation-waiting', { auditId: context.auditId, reason: consentSimulation.reason });

        // Save partial results and pause
        const db = getDatabase();
        db.prepare(`
          UPDATE audits
          SET status = ?
          WHERE id = ?
        `).run(constants.AUDIT_STATUS.PAUSED, context.auditId);

        context.consentSimulation = consentSimulation;
        context.paused = true;
        return;
      }

      if (consentSimulation.skipped) {
        logger.debug('scan-progress', { message: `Consent simulation skipped: ${consentSimulation.reason}`, auditId: context.auditId });
      } else {
        logger.debug('scan-progress', { message: `Consent simulation completed in ${consentSimulation.duration}s`, auditId: context.auditId });
      }

      context.consentSimulation = consentSimulation;
    } catch (error) {
      logger.error('consent-simulation-failed', {
        error: error.message,
        auditId: context.auditId,
        stack: error.stack
      });
      context.consentSimulation = {
        error: error.message,
        skipped: false,
        rejectScenario: { success: false },
        acceptScenario: { success: false }
      };
    }
  }
};

// ─── Step 17: Compliance Score ────────────────────────────────────
const stepComplianceScore = {
  name: 'stepComplianceScore',
  stepNumber: '17',
  critical: true,
  async execute(context) {
    // Build the results object that calculateOverallScore expects
    const auditResults = {
      policyAnalysis: context.policyAnalysis || null,
      bannerAnalysis: context.bannerAnalysis,
      scanResults: {
        tracking_before_consent: context.trackingAnalysis?.trackingBeforeConsent || false,
        cookies: context.cookies
      },
      consentSimulation: context.consentSimulation,
      cookieComparison: context.cookieComparison || null,
      consentModeAnalysis: context.consentModeAudit
    };

    context.complianceScore = calculateOverallScore(auditResults);

    logger.info('compliance-score-calculated', {
      auditId: context.auditId,
      overallScore: context.complianceScore.overallScore,
      grade: context.complianceScore.grade
    });
  }
};

/**
 * Helper: Build tracking-before-consent detailed data for frontend
 */
function buildTrackingBeforeConsentDetailed(context) {
  return {
    networkRequests: context.trackingBeforeConsentRequests.map(req => ({
      type: 'network',
      name: req.domain || (() => { try { return new URL(req.url).hostname; } catch { return 'unknown'; } })(),
      url: req.url,
      method: req.method,
      resourceType: req.resourceType,
      timestamp: req.timestamp,
      category: 'tracking'
    })),
    cookies: (context.trackingAnalysis?.identifiedTrackers || [])
      .filter(t => t.type === 'cookie')
      .map(t => ({
        type: 'cookie',
        name: t.name,
        value: t.value?.substring(0, 20) + '...',
        timestamp: t.timestamp,
        category: 'tracking'
      })),
    localStorage: (context.trackingAnalysis?.identifiedTrackers || [])
      .filter(t => t.type === 'localStorage')
      .map(t => ({
        type: 'localStorage',
        name: t.name,
        value: t.value?.substring(0, 20) + '...',
        timestamp: t.timestamp,
        category: 'tracking'
      })),
    indexedDB: (context.trackingAnalysis?.identifiedTrackers || [])
      .filter(t => t.type === 'indexedDB')
      .map(t => ({
        type: 'indexedDB',
        name: t.name,
        timestamp: t.timestamp,
        category: 'tracking'
      })),
    total: context.trackingBeforeConsentRequests.length + (context.trackingAnalysis?.violationCount || 0)
  };
}

// Export ordered step array
const finalizeSteps = [
  stepPersistScanResults,
  stepCloseBrowser,
  stepConsentSimulation,
  stepComplianceScore
];

module.exports = {
  finalizeSteps,
  buildTrackingBeforeConsentDetailed,
  stepPersistScanResults,
  stepCloseBrowser,
  stepConsentSimulation,
  stepComplianceScore
};
