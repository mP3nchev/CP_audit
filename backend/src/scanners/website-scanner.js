/**
 * Main Website Scanner Orchestrator
 *
 * After the step-runner refactor (Issue 1), this file contains:
 * - scanWebsite() — thin wrapper that creates context and runs steps
 * - updateProgress() — progress tracking (backward-compatible with runner)
 * - saveScanResults() — database persistence with field mapping comment
 * - savePartialResults() — partial save for paused audits
 * - continueAuditFromStep17() — resume after manual consent
 *
 * All scan logic lives in phase files:
 * - scan-phase-browser.js (Steps 1–6.6)
 * - scan-phase-analysis.js (Steps 7–13.7)
 * - scan-phase-finalize.js (Steps 14–17)
 */

const { closeBrowser } = require('./puppeteer-setup');
const { createScanContext } = require('./scan-context');
const { runSteps } = require('./step-runner');
const { browserSteps } = require('./scan-phase-browser');
const { analysisSteps } = require('./scan-phase-analysis');
const { finalizeSteps, buildTrackingBeforeConsentDetailed } = require('./scan-phase-finalize');

const { calculateOverallScore } = require('../analyzers/compliance-score-calculator');

const { getDatabase } = require('../database/db');
const { validateSchema } = require('../utils/schema-validator');
const { createLogger } = require('../utils/logger');

const constants = require('../config/constants');

const logger = createLogger('scanner');

/**
 * State machine for audit pipeline
 * Maps progress to explicit states for frontend polling
 */
const AUDIT_STATES = {
  INIT: 'INIT',
  SCANNING: 'SCANNING',
  SCREENSHOTS: 'SCREENSHOTS',
  UPLOADING: 'UPLOADING',
  SIMULATION: 'SIMULATION',
  SCORING: 'SCORING',
  DONE: 'DONE',
  FAILED: 'FAILED'
};

/**
 * Map step number to state
 * @param {number} step - Current step
 * @returns {string} State name
 */
function mapStepToState(step) {
  if (step <= 1) return AUDIT_STATES.INIT;
  if (step <= 10) return AUDIT_STATES.SCANNING;
  if (step <= 11) return AUDIT_STATES.SCREENSHOTS;
  if (step <= 12) return AUDIT_STATES.UPLOADING;
  if (step <= 16) return AUDIT_STATES.SIMULATION;
  if (step <= 17) return AUDIT_STATES.SCORING;
  return AUDIT_STATES.DONE;
}

/**
 * Estimate remaining time based on current step
 * @param {number} step - Current step
 * @param {number} totalSteps - Total steps
 * @param {number} elapsedSeconds - Time elapsed since start
 * @returns {number|null} Estimated seconds remaining
 */
function estimateRemainingTime(step, totalSteps, elapsedSeconds) {
  if (step === 0) return null;

  // Average time per step
  const avgTimePerStep = elapsedSeconds / step;

  // Steps remaining
  const stepsRemaining = totalSteps - step;

  // Estimated time (with buffer for heavier operations)
  const estimated = Math.round(avgTimePerStep * stepsRemaining * 1.2);

  return estimated > 0 ? estimated : null;
}

/**
 * Update scan progress and state in database
 * @param {number} auditId - Audit ID
 * @param {number} currentStep - Current step number
 * @param {number} totalSteps - Total number of steps
 * @param {string} message - Progress message
 * @param {number} startTime - Scan start time (Date.now())
 */
function updateProgress(auditId, currentStepOrInfo, totalSteps, message, startTime = Date.now(), extraMetadata = {}) {
  try {
    const db = getDatabase();
    const now = Date.now();

    // Accept both old format (number args) and new format (step object from runner)
    let currentStep, stepMessage;
    if (typeof currentStepOrInfo === 'object' && currentStepOrInfo !== null) {
      // New format: updateProgress(auditId, { stepNumber, name })
      currentStep = parseFloat(currentStepOrInfo.stepNumber) || 0;
      stepMessage = currentStepOrInfo.name || `Step ${currentStep}`;
      // When called from runner, totalSteps/message/startTime may not be passed
      totalSteps = totalSteps || 17;
      message = message || stepMessage;
      startTime = startTime || Date.now();
    } else {
      // Old format: updateProgress(auditId, currentStep, totalSteps, message, startTime, extraMetadata)
      currentStep = currentStepOrInfo;
    }

    const elapsedSeconds = Math.round((now - startTime) / 1000);

    // Use extraMetadata.state if provided (for WAITING_MANUAL_CONSENT)
    const state = extraMetadata.state || mapStepToState(currentStep);

    const progress = {
      currentStep,
      totalSteps,
      message,
      percentage: Math.round((currentStep / totalSteps) * 100),
      state: state,
      estimatedTimeRemaining: estimateRemainingTime(currentStep, totalSteps, elapsedSeconds),
      timestamp: now,
      metadata: {
        currentOperation: message,
        ...extraMetadata  // Merge extra metadata (websiteUrl, instructions, etc.)
      }
    };

    db.prepare(`
      UPDATE audits
      SET progress_json = ?
      WHERE id = ?
    `).run(JSON.stringify(progress), auditId);
  } catch (error) {
    logger.warn('progress-update-failed', {
      error: '⚠️ ' + error.message,
      auditId
    });
  }
}

/**
 * Scan a website for cookies and tracking
 *
 * Uses the step-runner architecture: creates a shared context, runs all steps
 * sequentially through the runner, and returns results.
 *
 * @param {string} websiteUrl - URL to scan
 * @param {number} auditId - Database audit ID
 * @param {string} auditUid - Audit unique identifier
 * @returns {Promise<Object>} Scan results
 */
async function scanWebsite(websiteUrl, auditId, auditUid) {
  const context = createScanContext(auditId, auditUid, websiteUrl);

  logger.info('scan-start', {
    auditId: auditUid,
    url: websiteUrl,
    startTime: new Date().toISOString()
  });

  try {
    const allSteps = [...browserSteps, ...analysisSteps, ...finalizeSteps];
    const result = await runSteps(allSteps, context, (stepInfo) => updateProgress(auditId, stepInfo, 17, stepInfo.name, context.startTime));

    if (!result.completed) {
      logger.error('scan-incomplete', { auditUid, errors: result.errors });
    }

    // Handle pause from consent simulation
    if (context.paused) {
      savePartialResults(auditId, buildResultsFromContext(context));

      return {
        paused: true,
        auditId,
        websiteUrl,
        instructions: context.consentSimulation?.instructions
      };
    }

    // Build final results object from context (for backward compatibility with callers)
    const results = buildResultsFromContext(context);

    context.scanDuration = Math.round((Date.now() - context.startTime) / 1000);

    logger.info('scan-complete', {
      auditId: auditUid,
      durationSeconds: context.scanDuration,
      cookieCount: context.cookies.length,
      trackingBeforeConsent: context.trackingAnalysis?.trackingBeforeConsent || false,
      complianceScore: context.complianceScore?.overallScore,
      grade: context.complianceScore?.grade,
      stepsRun: result.stepsRun,
      errors: result.errors.length
    });

    return results;

  } catch (error) {
    logger.error('scan-failed', {
      auditId: auditUid,
      error: error.message,
      stack: error.stack
    });

    // Close browser if still open
    if (context.browser) {
      await closeBrowser(context.browser).catch(() => {});
    }

    throw error;
  }
}

/**
 * Build a legacy-compatible results object from context
 * Used by callers that expect the old results shape
 */
function buildResultsFromContext(context) {
  return {
    cookies: context.cookies,
    cookieStats: context.cookieStats,
    trackingCookies: context.trackingCookies,
    networkRequests: context.networkMonitor ? context.networkMonitor.getRequests() : [],
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
    scanDuration: Math.round((Date.now() - context.startTime) / 1000),
    complianceScore: context.complianceScore,
    consentSimulation: context.consentSimulation
  };
}

/**
 * Save scan results to database
 *
 * CONTEXT FIELD MAPPING (generated during refactor — Commit 5a):
 * saveScanResults reads          → context/results key                  → assigned in step
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * auditId                        → context.auditId / param             → createScanContext
 * cookies                        → context.cookies                     → Step 7 (stepFinalCookieExtraction)
 * networkRequests                → networkMonitor.getRequests()         → Step 1.1 (stepInjectMonitoring)
 * trackingBeforeConsent          → trackingAnalysis.trackingBeforeConsent → Step 9 (stepClientSideTracking)
 * bannerViolations               → bannerAnalysis.violations           → Step 10 (stepBannerCompliance)
 * bannerAnalysis                 → context.bannerAnalysis              → Step 10 (stepBannerCompliance)
 * consentModeAudit               → context.consentModeAudit            → Step 10.5 (stepConsentModeDetection)
 * timeline                       → context.timeline                    → Step 13.5 (stepTimelineConstruction)
 * screenshots.full               → context.screenshotUrls.fullPageUrl  → Step 11 (disabled)
 * screenshots.banner             → context.screenshotUrls.bannerUrl    → Step 11 (disabled)
 * scanDuration                   → context.scanDuration                → calculated at persist time
 * complianceScore                → context.complianceScore             → Step 17 (stepComplianceScore)
 * trackingSummary                → context.trackingSummary             → Step 13.6 (stepNetworkCategorization)
 * consentSimulation              → context.consentSimulation           → Step 16 (stepConsentSimulation)
 * monitoringData                 → context.monitoringData              → Step 10.4 (stepConsentMonitorData)
 * monitoringAnalysis             → context.monitoringAnalysis          → Step 10.4 (stepConsentMonitorData)
 * detectedVendors                → context.detectedVendors             → Step 10.4 (stepConsentMonitorData)
 * vendorSummary                  → context.vendorSummary               → Step 10.4 (stepConsentMonitorData)
 * networkStorageCorrelations     → context.networkStorageCorrelations   → Step 13.7 (stepNetworkStorageCorrelation)
 * bannerDetectionStatus          → bannerAnalysis.bannerDetectionStatus → Step 10 (via detectBannerWithRetry)
 *
 * Total: 20 fields mapped (14 JSON blob columns + 6 scalar/derived fields)
 *
 * @param {number} auditId - Audit ID
 * @param {Object} results - Scan results (legacy format or context-derived)
 */
async function saveScanResults(auditId, results) {
  const db = getDatabase();

  try {
    // Check if new columns exist
    const tableInfo = db.prepare("PRAGMA table_info(scan_results)").all();
    const columnNames = tableInfo.map(col => col.name);
    const hasComplianceScore = columnNames.includes('compliance_score_json');
    const hasRequestCategorization = columnNames.includes('request_categorization_json');
    const hasConsentSimulation = columnNames.includes('consent_simulation_json');
    const hasMonitoringData = columnNames.includes('monitoring_data_json');
    const hasMonitoringAnalysis = columnNames.includes('monitoring_analysis_json');
    const hasDetectedVendors = columnNames.includes('detected_vendors_json');
    const hasVendorSummary = columnNames.includes('vendor_summary_json');
    const hasNetworkStorageCorr = columnNames.includes('network_storage_correlations_json');
    const hasBannerDetection = columnNames.includes('banner_detection_json');

    // Idempotent migration: add column if not present
    if (!hasNetworkStorageCorr) {
      try {
        db.exec(`ALTER TABLE scan_results ADD COLUMN network_storage_correlations_json TEXT`);
      } catch { /* column already exists */ }
    }

    // Build dynamic INSERT statement based on available columns
    let insertColumns = `
      audit_id,
      cookies_json,
      network_requests_json,
      tracking_before_consent,
      banner_violations_json,
      consent_mode_v2_status,
      timeline_json,
      screenshot_full_url,
      screenshot_banner_url,
      scan_duration_seconds
    `;
    let insertPlaceholders = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
    const insertValues = [
      auditId,
      JSON.stringify(results.cookies),
      JSON.stringify(results.networkRequests),
      results.trackingBeforeConsent ? 1 : 0,
      JSON.stringify(results.bannerViolations || []),
      JSON.stringify(results.consentModeAudit || {}),
      JSON.stringify(results.timeline || {}),
      results.screenshots.full || null,
      results.screenshots.banner || null,
      results.scanDuration
    ];

    if (hasComplianceScore) {
      insertColumns += ',\n      compliance_score_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.complianceScore || {}));
    }

    if (hasRequestCategorization) {
      insertColumns += ',\n      request_categorization_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.trackingSummary || {}));
    }

    if (hasConsentSimulation) {
      insertColumns += ',\n      consent_simulation_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.consentSimulation || {}));
    }

    if (hasMonitoringData) {
      insertColumns += ',\n      monitoring_data_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.monitoringData || null));
    }

    if (hasMonitoringAnalysis) {
      insertColumns += ',\n      monitoring_analysis_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.monitoringAnalysis || null));
    }

    if (hasDetectedVendors) {
      insertColumns += ',\n      detected_vendors_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.detectedVendors || []));
    }

    if (hasVendorSummary) {
      insertColumns += ',\n      vendor_summary_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.vendorSummary || null));
    }

    if (hasNetworkStorageCorr || true) { // column just migrated above — always include
      insertColumns += ',\n      network_storage_correlations_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.networkStorageCorrelations || null));
    }

    if (hasBannerDetection) {
      insertColumns += ',\n      banner_detection_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.bannerAnalysis?.bannerDetectionStatus || null));
    }

    // Validate critical payload shapes before writing to DB
    validateSchema('scanResult', {
      cookies: results.cookies,
      networkRequests: results.networkRequests,
      trackingBeforeConsent: results.trackingBeforeConsent,
      consentModeAudit: results.consentModeAudit || null
    });

    const stmt = db.prepare(`
      INSERT INTO scan_results (
        ${insertColumns}
      ) VALUES (${insertPlaceholders})
    `);

    try {
      stmt.run(...insertValues);
    } catch (err) {
      if (err.code === 'SCHEMA_VALIDATION_FAILED') {
        logger.error('scan-schema-validation-failed', {
          error: '❌ Schema validation failed',
          auditId,
          validationErrors: err.validationErrors
        });
        throw err;
      }
      throw Object.assign(err, { code: 'DB_WRITE_FAILED' });
    }

    // Update audits table with overall score
    if (results.complianceScore) {
      try {
        const updateStmt = db.prepare(`
          UPDATE audits
          SET overall_score = ?,
              score_grade = ?
          WHERE id = ?
        `);

        updateStmt.run(
          results.complianceScore.overallScore,
          results.complianceScore.grade,
          auditId
        );
      } catch (scoreUpdateError) {
        logger.warn('score-update-skipped', {
          message: '⚠️ Could not update overall_score (columns may not exist yet)',
          auditId
        });
      }
    }

    logger.debug('scan-progress', { message: '✅ Scan results saved to database', auditId });
  } catch (error) {
    logger.error('scan-save-failed', {
      error: '❌ ' + error.message,
      auditId,
      fullError: error.toString(),
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Save partial results to database (for paused audits)
 */
function savePartialResults(auditId, results) {
  try {
    const db = getDatabase();

    // Check if scan_results already exists
    const existing = db.prepare(`
      SELECT id FROM scan_results WHERE audit_id = ? LIMIT 1
    `).get(auditId);

    if (existing) {
      // Update existing (scan_results doesn't have updated_at column)
      // Just skip update for now
    } else {
      // Insert minimal record
      db.prepare(`
        INSERT INTO scan_results (
          audit_id,
          cookies_json,
          scan_duration_seconds,
          created_at
        ) VALUES (?, ?, ?, datetime('now'))
      `).run(auditId, JSON.stringify([]), 0);
    }

    logger.debug('scan-progress', { message: '   ✅ Partial results saved', auditId });
  } catch (error) {
    logger.warn('partial-results-save-failed', {
      error: '⚠️ ' + error.message,
      auditId
    });
  }
}

/**
 * Continue audit from Step 17 (after manual consent upload)
 */
async function continueAuditFromStep17(auditId, websiteUrl) {
  logger.debug('scan-progress', { message: '', auditId });
  logger.debug('scan-progress', { message: '▶️  === RESUMING AUDIT FROM STEP 17 ===', auditId });
  logger.debug('scan-progress', { message: `   Audit ID: ${auditId}`, auditId });
  logger.debug('scan-progress', { message: `   Website: ${websiteUrl}`, auditId });
  logger.debug('scan-progress', { message: '', auditId });

  const startTime = Date.now();
  const db = getDatabase();

  try {
    // Load existing scan results
    const scanResult = db.prepare(`
      SELECT * FROM scan_results WHERE audit_id = ? LIMIT 1
    `).get(auditId);

    if (!scanResult) {
      throw new Error('No scan results found for this audit');
    }

    // Parse existing data
    const cookies = scanResult.cookies_json ? JSON.parse(scanResult.cookies_json) : [];
    const consentSimulation = scanResult.consent_simulation_json ? JSON.parse(scanResult.consent_simulation_json) : null;

    // Build results object
    const results = {
      cookies,
      consentSimulation,
      // Other fields will be loaded from database as needed
    };

    // Step 17: Calculate overall compliance score
    let stepStartTime = Date.now();
    logger.debug('scan-progress', { message: '', auditId });
    logger.debug('scan-progress', { message: '📊 Step 17: Calculating overall compliance score...', auditId });
    updateProgress(auditId, 17, 17, 'Calculating compliance score and finalizing report...', startTime);

    const complianceScore = calculateOverallScore(results);
    results.complianceScore = complianceScore;

    logger.debug('scan-progress', { message: `   ✅ Compliance score calculated in ${Date.now() - stepStartTime}ms`, auditId });
    logger.debug('scan-progress', { message: `   📊 Overall Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`, auditId });

    // Update database with compliance score
    db.prepare(`
      UPDATE audits
      SET overall_score = ?,
          score_grade = ?,
          status = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `).run(
      complianceScore.overallScore,
      complianceScore.grade,
      'completed',
      auditId
    );

    logger.debug('scan-progress', { message: '', auditId });
    logger.debug('scan-progress', { message: '✅ === AUDIT RESUMED AND COMPLETED ===', auditId });
    logger.debug('scan-progress', { message: `   Total duration: ${Math.round((Date.now() - startTime) / 1000)}s`, auditId });
    logger.debug('scan-progress', { message: '', auditId });

  } catch (error) {
    logger.error('audit-resume-failed', {
      error: '❌ ' + error.message,
      auditId,
      fullError: error.toString(),
      stack: error.stack
    });
    throw error;
  }
}

module.exports = {
  scanWebsite,
  saveScanResults,
  continueAuditFromStep17
};
