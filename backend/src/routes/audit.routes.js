const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/db');
const { fork } = require('child_process');
const path = require('path');
const { analyzePolicyFile, getPolicyAnalysis } = require('../analyzers/privacy-policy-analyzer');
const { uploadMultipleFiles } = require('../middleware/file-upload');
const { compareCookiePolicy, saveComparison } = require('../analyzers/cookie-policy-comparator');
const { assessRisk, saveRiskAssessment } = require('../analyzers/risk-assessor');
const { generateSolutions } = require('../analyzers/solution-generator');
const { calculateOverallScore } = require('../analyzers/compliance-score-calculator');
const { renderReactReportToHTML, renderReactReportToPDF } = require('../generators/react-report-renderer');
const { uploadBlob } = require('../integrations/blob-storage');
const { checkBudget } = require('../integrations/claude-api');
const constants = require('../config/constants');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const logger = createLogger('audit');

/**
 * Fork an isolated child process to run the scan.
 * If Puppeteer crashes or the worker is OOM-killed, only the child dies —
 * the Express server remains alive.
 *
 * @param {string} websiteUrl
 * @param {number} auditId   - numeric DB row id
 * @param {string} auditUid  - human-readable uid for logging
 */
function forkScanWorker(websiteUrl, auditId, auditUid) {
  const workerPath = path.join(__dirname, '../scanners/scan-worker.js');
  const worker = fork(workerPath, [], { env: process.env });

  worker.send({ websiteUrl, auditId, auditUid });

  worker.on('message', (msg) => {
    if (msg.type === 'paused') {
      logger.info('audit-paused', { auditId: auditUid, reason: 'awaiting_manual_consent' });
    } else if (msg.type === 'completed') {
      logger.info('audit-completed', { auditId: auditUid });
    } else if (msg.type === 'failed') {
      logger.error('audit-failed', { auditId: auditUid, error: msg.error });
    }
  });

  // Handle worker killed by signal (OOM, uncaught crash)
  worker.on('exit', (code, signal) => {
    if (signal) {
      logger.error('worker-killed', { auditId: auditUid, signal, pid: worker.pid });
      try {
        const db = getDatabase();
        db.prepare(`
          UPDATE audits
          SET status = ?,
              error_message = ?
          WHERE id = ?
        `).run(constants.AUDIT_STATUS.FAILED, `Worker killed: ${signal}`, auditId);
      } catch (dbError) {
        logger.error('worker-db-update-failed', { error: dbError.message });
      }
    }
  });

  worker.on('error', (error) => {
    logger.error('worker-spawn-error', { auditId: auditUid, error: error.message });
  });
}

/**
 * Start a new audit
 * POST /api/audit/start
 * Body: { website_url: string }
 */
router.post('/api/audit/start', async (req, res) => {
  let auditId = null;

  try {
    const { website_url, client_name, industry } = req.body;

    // Validate URL
    if (!website_url) {
      return res.status(400).json({
        error: 'Missing website_url',
        code: 'E003'
      });
    }

    // Validate URL format
    try {
      new URL(website_url);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid URL format',
        code: 'E003',
        message: constants.ERROR_CODES.INVALID_URL.message
      });
    }

    // Check budget before starting audit
    const budget = checkBudget();
    if (!budget.allowed) {
      logger.warn('budget-exceeded', {
        spent: budget.spent.toFixed(2),
        limit: budget.limit,
        retryAfter: budget.retryAfter
      });
      return res.status(429).json({
        error: `Daily Claude API budget exceeded ($${budget.limit}). Try again later.`,
        code: 'E429',
        spent: budget.spent,
        limit: budget.limit,
        retryAfter: budget.retryAfter
      });
    }

    // Generate unique audit ID
    const auditUid = `aud_${crypto.randomBytes(8).toString('hex')}`;

    // Create audit record
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT INTO audits (audit_uid, website_url, client_name, industry, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    const result = stmt.run(auditUid, website_url, client_name || null, industry || null, constants.AUDIT_STATUS.PROCESSING);
    auditId = result.lastInsertRowid;

    logger.info('audit-created', { auditId: auditUid, dbId: auditId, url: website_url });

    // Start scanning in an isolated child process
    forkScanWorker(website_url, auditId, auditUid);

    // Return immediate response
    res.status(200).json({
      audit_id: auditUid,
      status: 'processing',
      created_at: new Date().toISOString(),
      estimated_duration: '3-5 minutes',
      message: 'Audit started successfully'
    });

  } catch (error) {
    logger.error('audit-start-failed', { error: error.message, stack: error.stack });

    // If audit was created, mark it as failed
    if (auditId) {
      try {
        const db = getDatabase();
        const updateStmt = db.prepare(`
          UPDATE audits
          SET status = ?, error_message = ?
          WHERE id = ?
        `);
        updateStmt.run(constants.AUDIT_STATUS.FAILED, error.message, auditId);
      } catch (dbError) {
        logger.error('audit-status-update-failed', { auditId, error: dbError.message });
      }
    }

    res.status(500).json({
      error: 'Failed to start audit',
      message: error.message
    });
  }
});

/**
 * Get audit status
 * GET /api/audit/:audit_id/status
 */
router.get('/api/audit/:audit_id/status', (req, res) => {
  try {
    const { audit_id } = req.params;

    const db = getDatabase();
    const audit = db.prepare(`
      SELECT
        audit_uid,
        website_url,
        status,
        error_message,
        progress_json,
        created_at,
        updated_at,
        completed_at
      FROM audits
      WHERE audit_uid = ?
    `).get(audit_id);

    if (!audit) {
      return res.status(404).json({
        error: 'Audit not found',
        code: 'E404'
      });
    }

    // Parse progress JSON to extract state machine info
    let progressData = null;
    if (audit.progress_json) {
      try {
        progressData = JSON.parse(audit.progress_json);
      } catch (error) {
        console.warn('Failed to parse progress JSON:', error);
      }
    }

    // Map audit status to state
    let state = 'INIT';
    if (audit.status === constants.AUDIT_STATUS.COMPLETED) {
      state = 'DONE';
    } else if (audit.status === constants.AUDIT_STATUS.FAILED) {
      state = 'FAILED';
    } else if (audit.status === constants.AUDIT_STATUS.PAUSED) {
      state = 'WAITING_MANUAL_CONSENT';
    } else if (progressData && progressData.state) {
      state = progressData.state;
    } else if (audit.status === constants.AUDIT_STATUS.PROCESSING) {
      state = 'SCANNING';  // Fallback
    }

    // Build enhanced response with state machine
    const response = {
      audit_id: audit.audit_uid,
      website_url: audit.website_url,
      status: audit.status,
      state: state,  // REQUIRED for polling logic
      progress: progressData ? progressData.percentage : 0,  // REQUIRED (0-100)
      estimatedTimeRemaining: progressData?.estimatedTimeRemaining || null,  // OPTIONAL
      metadata: progressData?.metadata || null,  // OPTIONAL
      created_at: audit.created_at,
      updated_at: audit.updated_at
    };

    if (audit.status === constants.AUDIT_STATUS.COMPLETED) {
      response.completed_at = audit.completed_at;
      response.report_url = `/api/audit/${audit.audit_uid}/report`;
    }

    if (audit.status === constants.AUDIT_STATUS.FAILED) {
      response.error_message = audit.error_message;
    }

    if (audit.status === constants.AUDIT_STATUS.PAUSED) {
      // Add pause-specific data for manual consent simulation
      if (progressData && progressData.metadata) {
        response.websiteUrl = progressData.metadata.websiteUrl || audit.website_url;
        response.instructions = progressData.metadata.instructions;
      }
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Failed to get audit status:', error);
    res.status(500).json({
      error: 'Failed to get audit status',
      message: error.message
    });
  }
});

/**
 * Resume audit from waiting state
 * POST /api/audit/:audit_id/resume
 */
router.post('/api/audit/:audit_id/resume', async (req, res) => {
  try {
    const { audit_id } = req.params;

    const db = getDatabase();

    // Get audit info
    const audit = db.prepare(`
      SELECT id, audit_uid, website_url, status
      FROM audits
      WHERE audit_uid = ? OR id = ?
    `).get(audit_id, audit_id);

    if (!audit) {
      return res.status(404).json({
        error: 'Audit not found',
        code: 'E404'
      });
    }

    // Check if audit is in PAUSED state (waiting for manual consent)
    if (audit.status !== constants.AUDIT_STATUS.PAUSED) {
      return res.status(400).json({
        error: 'Audit is not in paused state. Current status: ' + audit.status,
        status: audit.status
      });
    }

    // Check if consent simulation data has been uploaded
    const scanResult = db.prepare(`
      SELECT consent_simulation_json
      FROM scan_results
      WHERE audit_id = ? AND consent_simulation_json IS NOT NULL
      LIMIT 1
    `).get(audit.id);

    if (!scanResult || !scanResult.consent_simulation_json) {
      return res.status(400).json({
        error: 'No manual consent simulation data found. Please upload data first.',
        code: 'E_NO_CONSENT_DATA'
      });
    }

    console.log('');
    console.log(`📤 Resume request received for audit: ${audit.audit_uid}`);
    console.log(`   Consent data found: Yes`);
    console.log(`   Continuing from Step 17...`);

    // Update audit status back to PROCESSING
    db.prepare(`
      UPDATE audits
      SET status = ?
      WHERE id = ?
    `).run(constants.AUDIT_STATUS.PROCESSING, audit.id);

    console.log(`   ✅ Audit status updated: PAUSED → PROCESSING`);

    // Import scanner dynamically to avoid circular dependency
    const { continueAuditFromStep17 } = require('../scanners/website-scanner');

    // Continue audit from Step 17 in background
    continueAuditFromStep17(audit.id, audit.website_url).catch(err => {
      console.error(`Failed to resume audit ${audit.audit_uid}:`, err);

      // Update audit status to failed
      db.prepare(`
        UPDATE audits
        SET status = ?, error_message = ?
        WHERE id = ?
      `).run(constants.AUDIT_STATUS.FAILED, err.message, audit.id);
    });

    res.json({
      message: 'Audit resumed successfully',
      audit_id: audit.audit_uid,
      status: 'resumed',
      note: 'Audit is now continuing from Step 17. Poll /api/audit/:id/status for completion.'
    });

  } catch (error) {
    console.error('❌ Failed to resume audit:', error);
    res.status(500).json({
      error: 'Failed to resume audit',
      message: error.message
    });
  }
});

/**
 * Get audit results (detailed)
 * GET /api/audit/:audit_id/results
 */
router.get('/api/audit/:audit_id/results', (req, res) => {
  try {
    const { audit_id } = req.params;

    const db = getDatabase();

    // Get audit info
    const audit = db.prepare(`
      SELECT * FROM audits WHERE audit_uid = ?
    `).get(audit_id);

    if (!audit) {
      return res.status(404).json({
        error: 'Audit not found',
        code: 'E404'
      });
    }

    if (audit.status !== constants.AUDIT_STATUS.COMPLETED) {
      return res.status(400).json({
        error: 'Audit not completed',
        status: audit.status,
        message: audit.status === constants.AUDIT_STATUS.FAILED
          ? audit.error_message
          : 'Audit is still processing'
      });
    }

    // Get scan results
    const scanResults = db.prepare(`
      SELECT * FROM scan_results WHERE audit_id = ?
    `).get(audit.id);

    if (!scanResults) {
      return res.status(404).json({
        error: 'Scan results not found'
      });
    }

    // Parse JSON fields
    const results = {
      audit: {
        audit_id: audit.audit_uid,
        website_url: audit.website_url,
        status: audit.status,
        created_at: audit.created_at,
        completed_at: audit.completed_at
      },
      scan: {
        cookies: JSON.parse(scanResults.cookies_json || '[]'),
        network_requests: JSON.parse(scanResults.network_requests_json || '[]'),
        tracking_before_consent: !!scanResults.tracking_before_consent,
        screenshots: {
          full: scanResults.screenshot_full_url,
          banner: scanResults.screenshot_banner_url
        },
        scan_duration_seconds: scanResults.scan_duration_seconds
      }
    };

    res.json(results);

  } catch (error) {
    console.error('❌ Failed to get audit results:', error);
    res.status(500).json({
      error: 'Failed to get audit results',
      message: error.message
    });
  }
});

/**
 * List all audits
 * GET /api/audits
 */
router.get('/api/audits', (req, res) => {
  try {
    const db = getDatabase();
    const audits = db.prepare(`
      SELECT
        audit_uid,
        website_url,
        status,
        created_at,
        completed_at
      FROM audits
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    res.json({
      count: audits.length,
      audits: audits
    });

  } catch (error) {
    console.error('❌ Failed to list audits:', error);
    res.status(500).json({
      error: 'Failed to list audits',
      message: error.message
    });
  }
});

/**
 * Upload and analyze privacy policy + run Phase 3 audits
 * POST /api/audit/:audit_id/privacy-policy
 * Form data: privacy_policy (file), cookie_policy (file, optional)
 */
router.post(
  '/api/audit/:audit_id/privacy-policy',
  uploadMultipleFiles([
    { name: 'privacy_policy', maxCount: 1 },
    { name: 'cookie_policy', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { audit_id } = req.params;

      // Get audit from database
      const db = getDatabase();
      const audit = db.prepare(`
        SELECT * FROM audits WHERE audit_uid = ?
      `).get(audit_id);

      if (!audit) {
        return res.status(404).json({
          error: 'Audit not found',
          code: 'E404'
        });
      }

      // Check if files were uploaded
      if (!req.files || !req.files.privacy_policy) {
        return res.status(400).json({
          error: 'Missing privacy_policy file',
          message: 'Please upload a privacy policy file (PDF, DOCX, or HTML)'
        });
      }

      const privacyPolicyFile = req.files.privacy_policy[0];
      const cookiePolicyFile = req.files.cookie_policy ? req.files.cookie_policy[0] : null;

      console.log(`📤 Received policy files for audit ${audit_id}`);
      console.log(`   Privacy policy: ${privacyPolicyFile.originalname} (${(privacyPolicyFile.size / 1024).toFixed(2)} KB)`);
      if (cookiePolicyFile) {
        console.log(`   Cookie policy: ${cookiePolicyFile.originalname} (${(cookiePolicyFile.size / 1024).toFixed(2)} KB)`);
      }

      // PHASE 2: Analyze privacy policy
      console.log('');
      console.log('=== PHASE 2: Privacy Policy Analysis ===');
      const privacyResult = await analyzePolicyFile(
        privacyPolicyFile.buffer,
        privacyPolicyFile.originalname,
        audit.id,
        'privacy'
      );

      // Analyze cookie policy if provided
      let cookieResult = null;
      if (cookiePolicyFile) {
        cookieResult = await analyzePolicyFile(
          cookiePolicyFile.buffer,
          cookiePolicyFile.originalname,
          audit.id,
          'cookie'
        );
      }

      // PHASE 3: Run comprehensive analysis asynchronously
      console.log('');
      console.log('=== PHASE 3: Technical Audits & Risk Assessment ===');
      runPhase3Analysis(audit.id, audit.audit_uid, cookiePolicyFile)
        .then(() => {
          console.log(`✅ Phase 3 complete for audit ${audit.audit_uid}`);
        })
        .catch(error => {
          console.error(`❌ Phase 3 failed for audit ${audit.audit_uid}:`, error.message);
        });

      // Return immediate results (Phase 2 only)
      res.json({
        audit_id: audit.audit_uid,
        phase: 2,
        message: 'Privacy policy analyzed. Phase 3 (risk assessment, solutions) running in background.',
        privacy_policy: {
          analyzed: true,
          score: privacyResult.analysis.total_score,
          max_score: privacyResult.analysis.max_score,
          percentage: privacyResult.analysis.percentage,
          category: privacyResult.analysis.category,
          criteria_count: privacyResult.analysis.criteria?.length || 0,
          cost: `$${privacyResult.usage.cost_usd.toFixed(4)}`,
          duration: `${privacyResult.duration}s`
        },
        cookie_policy: cookieResult ? {
          analyzed: true,
          score: cookieResult.analysis.total_score,
          max_score: cookieResult.analysis.max_score,
          percentage: cookieResult.analysis.percentage,
          category: cookieResult.analysis.category,
          cost: `$${cookieResult.usage.cost_usd.toFixed(4)}`,
          duration: `${cookieResult.duration}s`
        } : {
          analyzed: false,
          message: 'Cookie policy not provided'
        }
      });

    } catch (error) {
      console.error('❌ Failed to analyze policy:', error);
      res.status(500).json({
        error: 'Failed to analyze policy',
        message: error.message
      });
    }
  }
);

/**
 * Run Phase 3 analysis (async)
 * @param {number} auditId - Audit ID
 * @param {string} auditUid - Audit UID
 * @param {Object} cookiePolicyFile - Cookie policy file (if provided)
 */
async function runPhase3Analysis(auditId, auditUid, cookiePolicyFile) {
  try {
    const db = getDatabase();

    // Get scan results from Phase 1
    const scanResults = db.prepare(`
      SELECT * FROM scan_results WHERE audit_id = ?
    `).get(auditId);

    if (!scanResults) {
      console.log('⚠️  Scan results not found, skipping Phase 3');
      return;
    }

    // Get policy analysis from Phase 2
    const privacyAnalysis = getPolicyAnalysis(auditId, 'privacy');

    if (!privacyAnalysis) {
      console.log('⚠️  Privacy policy analysis not found, skipping Phase 3');
      return;
    }

    // Parse scan results
    const cookies = JSON.parse(scanResults.cookies_json || '[]');
    const networkRequests = JSON.parse(scanResults.network_requests_json || '[]');
    const bannerViolations = JSON.parse(scanResults.banner_violations_json || '[]');
    const consentModeStatus = scanResults.consent_mode_v2_status ?
      JSON.parse(scanResults.consent_mode_v2_status) : null;

    // Task 1: Cookie Policy Comparison (if cookie policy provided)
    let cookieComparison = null;
    if (cookiePolicyFile) {
      try {
        console.log('🍪 Comparing Cookie Policy with detected cookies...');
        cookieComparison = await compareCookiePolicy(
          cookiePolicyFile.buffer,
          cookiePolicyFile.originalname,
          cookies,
          auditId
        );

        // Save to database
        saveComparison(db, auditId, cookieComparison);
      } catch (error) {
        console.error('Cookie comparison failed:', error.message);
      }
    }

    // Task 2: Risk Assessment
    console.log('⚖️  Assessing GDPR compliance risk...');
    const violations = {
      trackingBeforeConsent: !!scanResults.tracking_before_consent,
      trackingBeforeConsentCount: networkRequests.filter(r => r.beforeConsent).length,
      bannerViolations,
      privacyPolicyScore: privacyAnalysis.percentage || 0,
      privacyPolicyFailedCriteria: privacyAnalysis.criteria?.filter(c => c.score < c.weight) || [],
      undeclaredCookies: cookieComparison?.undeclared || [],
      consentModeCompliant: consentModeStatus?.compliant || false,
      consentModeIssues: consentModeStatus?.issues || []
    };

    const riskAssessment = await assessRisk(violations);
    saveRiskAssessment(db, auditId, riskAssessment, violations);

    // Task 3: Generate Solutions
    console.log('💡 Generating personalized solutions...');
    const auditData = {
      ...violations,
      websiteUrl: scanResults.website_url,
      overallScore: 0,  // Will be calculated next
      riskLevel: riskAssessment.risk_level
    };

    const solutions = await generateSolutions(auditData);

    // Task 4: Calculate Overall Compliance Score
    console.log('📊 Calculating overall compliance score...');
    const scoreResult = calculateOverallScore({
      scanResults: {
        tracking_before_consent: !!scanResults.tracking_before_consent,
        cookies
      },
      policyAnalysis: privacyAnalysis,
      bannerAnalysis: {
        violations: bannerViolations,
        totalChecks: 8,
        passedCount: 8 - bannerViolations.length
      },
      consentModeAnalysis: consentModeStatus,
      cookieComparison
    });

    // Update audit record with overall score
    db.prepare(`
      UPDATE audits
      SET overall_score = ?,
          score_grade = ?
      WHERE id = ?
    `).run(scoreResult.overallScore, scoreResult.grade, auditId);

    console.log('');
    console.log('✅ === PHASE 3 COMPLETE ===');
    console.log(`   Overall Score: ${scoreResult.overallScore}/100 (Grade ${scoreResult.grade})`);
    console.log(`   Risk Level: ${riskAssessment.risk_level}`);
    console.log(`   Risk Range: €${riskAssessment.risk_min} - €${riskAssessment.risk_max}`);
    console.log(`   Solutions: ${solutions.length} recommendations generated`);
    console.log('');

  } catch (error) {
    console.error('❌ Phase 3 analysis failed:', error);
    throw error;
  }
}

/**
 * Get policy analysis results
 * GET /api/audit/:audit_id/policy-analysis
 */
router.get('/api/audit/:audit_id/policy-analysis', (req, res) => {
  try {
    const { audit_id } = req.params;

    const db = getDatabase();
    const audit = db.prepare(`
      SELECT * FROM audits WHERE audit_uid = ?
    `).get(audit_id);

    if (!audit) {
      return res.status(404).json({
        error: 'Audit not found',
        code: 'E404'
      });
    }

    // Get policy analyses
    const privacyAnalysis = getPolicyAnalysis(audit.id, 'privacy');
    const cookieAnalysis = getPolicyAnalysis(audit.id, 'cookie');

    res.json({
      audit_id: audit.audit_uid,
      privacy_policy: privacyAnalysis || { analyzed: false },
      cookie_policy: cookieAnalysis || { analyzed: false }
    });

  } catch (error) {
    console.error('❌ Failed to get policy analysis:', error);
    res.status(500).json({
      error: 'Failed to get policy analysis',
      message: error.message
    });
  }
});

/**
 * Legacy report endpoint — redirects to React v2
 * GET /api/audit/:audit_id/report
 *
 * @deprecated Permanently redirected to /api/audit/:audit_id/report-v2
 */
router.get('/api/audit/:audit_id/report', (req, res) => {
  const { audit_id } = req.params;
  logger.info('legacy-report-redirect', { auditUid: audit_id });
  res.redirect(301, `/api/audit/${audit_id}/report-v2`);
});

/**
 * Generate shareable report link (upload to Vercel Blob)
 * GET /api/audit/:audit_id/share
 */
router.get('/api/audit/:audit_id/share', async (req, res) => {
  try {
    const { audit_id } = req.params;

    console.log(`🔗 Generating shareable link for audit ${audit_id}...`);

    // Verify audit exists
    const db = getDatabase();
    const audit = db.prepare(`
      SELECT * FROM audits WHERE audit_uid = ?
    `).get(audit_id);

    if (!audit) {
      return res.status(404).json({
        error: 'Audit not found',
        code: 'E404'
      });
    }

    // Check if audit is completed
    if (audit.status !== constants.AUDIT_STATUS.COMPLETED) {
      return res.status(400).json({
        error: 'Audit not completed',
        message: 'Report cannot be shared until audit is complete',
        status: audit.status
      });
    }

    // Generate HTML report using React v2 renderer
    let html;
    console.log('   Rendering React v2 report...');
    html = await renderReactReportToHTML(audit_id);
    console.log('   React v2 rendering successful');

    // Upload to Vercel Blob
    const filename = `report-${audit_id}-${Date.now()}.html`;
    const blobUrl = await uploadBlob(Buffer.from(html, 'utf8'), filename);

    console.log(`✅ Report uploaded: ${blobUrl}`);

    // Return v2 Vercel URL as primary, blob as fallback
    const v2Url = `https://cp-audit.vercel.app/report-v2/${audit_id}`;

    res.json({
      audit_id: audit_id,
      share_url: v2Url,
      blob_url: blobUrl,
      filename: filename,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to generate shareable link:', error);
    res.status(500).json({
      error: 'Failed to generate shareable link',
      message: error.message
    });
  }
});

/**
 * Generate v2 report data (JSON format for React template)
 * GET /api/audit/:audit_id/report-v2
 *
 * Purpose: Provide structured JSON data for the premium v2 report template
 * This route runs in parallel to the existing /report route (non-breaking)
 */
router.get('/api/audit/:audit_id/report-v2', async (req, res) => {
  try {
    const { audit_id } = req.params;

    console.log(`📊 Generating v2 report data for audit ${audit_id}...`);

    // Verify audit exists
    const db = getDatabase();
    const audit = db.prepare(`
      SELECT * FROM audits WHERE audit_uid = ?
    `).get(audit_id);

    if (!audit) {
      return res.status(404).json({
        error: 'Audit not found',
        code: 'E404'
      });
    }

    // Check if audit is completed
    if (audit.status !== constants.AUDIT_STATUS.COMPLETED) {
      return res.status(400).json({
        error: 'Audit not completed',
        message: 'Report data cannot be generated until audit is complete',
        status: audit.status
      });
    }

    // Import data adapter
    const { adaptAuditDataToReportModel } = require('../generators/report-data-adapter');

    // Generate structured report data
    const reportData = await adaptAuditDataToReportModel(audit_id);

    console.log(`✅ v2 Report data generated successfully`);

    // Return JSON
    res.json(reportData);

  } catch (error) {
    console.error('❌ Failed to generate v2 report data:', error);
    res.status(500).json({
      error: 'Failed to generate v2 report data',
      message: error.message
    });
  }
});

/**
 * Manual Consent Data Upload
 * POST /api/audit/manual-consent/upload
 * Body: { websiteUrl, scenarios: { reject, accept }, metadata }
 *
 * Purpose: Accept manual consent simulation data from headful Puppeteer script
 */
router.post('/api/audit/manual-consent/upload', express.json({ limit: '50mb' }), async (req, res) => {
  let auditId = null;

  try {
    const { websiteUrl, scenarios, metadata, auditId: providedAuditId } = req.body;

    // Validation
    if (!websiteUrl || !scenarios) {
      return res.status(400).json({
        error: 'Missing required fields: websiteUrl, scenarios',
        code: 'E003'
      });
    }

    if (!scenarios.reject) {
      return res.status(400).json({
        error: 'Missing reject scenario data',
        code: 'E003'
      });
    }

    console.log('');
    console.log('📤 Manual consent data upload received');
    console.log(`   Website: ${websiteUrl}`);
    console.log(`   Provided audit ID: ${providedAuditId || 'None (will create new)'}`);
    console.log(`   Reject scenario: ${scenarios.reject ? 'Yes' : 'No'}`);
    console.log(`   Accept scenario: ${scenarios.accept ? 'Yes' : 'No'}`);

    const db = getDatabase();
    let auditUid;

    // Check if updating existing audit or creating new
    if (providedAuditId) {
      // Find existing audit
      const existingAudit = db.prepare(`
        SELECT id, audit_uid FROM audits WHERE audit_uid = ? OR id = ?
      `).get(providedAuditId, providedAuditId);

      if (existingAudit) {
        auditId = existingAudit.id;
        auditUid = existingAudit.audit_uid;
        console.log(`   📝 Updating existing audit: ${auditUid} (ID: ${auditId})`);
      } else {
        // Audit not found on this server — create new audit instead of failing
        // This handles cross-environment uploads (e.g. local audit ID → production server)
        console.warn(`   ⚠️  Audit ${providedAuditId} not found on this server, creating new audit`);
        auditUid = `aud_${crypto.randomBytes(8).toString('hex')}`;
        const auditStmt = db.prepare(`
          INSERT INTO audits (audit_uid, website_url, status, created_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
        `);
        const newResult = auditStmt.run(auditUid, websiteUrl, constants.AUDIT_STATUS.PROCESSING);
        auditId = newResult.lastInsertRowid;
        console.log(`   📝 Created new audit: ${auditUid} (ID: ${auditId}) [original ID: ${providedAuditId}]`);
      }
    } else {
      // Create new audit
      auditUid = `aud_${crypto.randomBytes(8).toString('hex')}`;

      const auditStmt = db.prepare(`
        INSERT INTO audits (audit_uid, website_url, status, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `);

      const result = auditStmt.run(auditUid, websiteUrl, constants.AUDIT_STATUS.PROCESSING);
      auditId = result.lastInsertRowid;

      console.log(`   📝 Created new audit: ${auditUid} (ID: ${auditId})`);
    }

    // ============================================
    // PROCESS CONSENT SIMULATION DATA
    // ============================================
    const rejectScenario = scenarios.reject;
    const acceptScenario = scenarios.accept;

    // Extract cookies from scenarios
    const cookiesBeforeConsent = rejectScenario.before.cookies || [];
    const cookiesAfterReject = rejectScenario.after.cookies || [];
    const cookiesAfterAccept = acceptScenario ? (acceptScenario.after.cookies || []) : [];

    // Detect tracking cookies after reject (GDPR violation)
    const trackingCookiesInReject = cookiesAfterReject.filter(c =>
      c.name.includes('_ga') || c.name.includes('_gid') ||
      c.name.includes('_fbp') || c.name.includes('_hjid') ||
      c.name.includes('doubleclick') || c.name.includes('_utm')
    );

    // Click count comparison (from tracking data if available)
    const clickImbalance = 0; // TODO: Extract from trackingData if implemented

    // Calculate new cookies (present in accept but not in reject)
    const newCookiesAfterAccept = cookiesAfterAccept.filter(acceptCookie => {
      return !cookiesAfterReject.some(rejectCookie =>
        rejectCookie.name === acceptCookie.name && rejectCookie.domain === acceptCookie.domain
      );
    });

    // Build consent simulation results
    const consentSimulation = {
      reject: {
        cookiesBeforeConsent: cookiesBeforeConsent.length,
        cookiesAfterConsent: cookiesAfterReject.length,
        clickCount: 1, // TODO: Extract from tracking data
        clickPath: ['Manual interaction'],
        trackingData: rejectScenario.after.trackingData
      },
      accept: acceptScenario ? {
        cookiesBeforeConsent: acceptScenario.before.cookies.length,
        cookiesAfterConsent: cookiesAfterAccept.length,
        clickCount: 1, // TODO: Extract from tracking data
        clickPath: ['Manual interaction'],
        trackingData: acceptScenario.after.trackingData
      } : null,
      comparison: {
        clickImbalance,
        clickViolation: clickImbalance > 0,
        cookiesBeforeConsent: cookiesBeforeConsent.length,
        cookiesAfterReject: cookiesAfterReject.length,
        cookiesAfterAccept: cookiesAfterAccept.length,
        trackingCookiesInReject: trackingCookiesInReject.length,
        cookieDifference: cookiesAfterAccept.length - cookiesAfterReject.length,
        newCookies: newCookiesAfterAccept.map(c => ({
          name: c.name,
          domain: c.domain || 'N/A',
          category: c.category || 'unknown',
          purpose: c.purpose || 'Not specified'
        })),
        violations: []
      }
    };

    // Detect violations
    if (clickImbalance > 0) {
      consentSimulation.comparison.violations.push({
        type: 'click_imbalance',
        severity: 'critical',
        description: `Reject requires ${clickImbalance} more clicks than Accept`,
        legal_basis: 'GDPR Article 7(3) - Withdrawal must be as easy as giving consent'
      });
    }

    if (trackingCookiesInReject.length > 0) {
      consentSimulation.comparison.violations.push({
        type: 'tracking_after_reject',
        severity: 'critical',
        description: `${trackingCookiesInReject.length} tracking cookies found after rejection`,
        cookies: trackingCookiesInReject.map(c => c.name),
        legal_basis: 'ePrivacy Directive Article 5(3) - Consent required for non-essential cookies'
      });
    }

    const cookieDifference = cookiesAfterAccept.length - cookiesAfterReject.length;
    if (acceptScenario && cookieDifference <= 0) {
      consentSimulation.comparison.violations.push({
        type: 'no_consent_effect',
        severity: 'high',
        description: 'Accept and Reject produce same cookies - consent mechanism ineffective',
        legal_basis: 'GDPR Article 4(11) - Consent must have real effect'
      });
    }

    // ============================================
    // SAVE TO DATABASE
    // ============================================
    // Check if scan_results already exists for this audit
    const existingScan = db.prepare(`
      SELECT id FROM scan_results WHERE audit_id = ? LIMIT 1
    `).get(auditId);

    if (existingScan) {
      // Update existing scan_results
      const updateStmt = db.prepare(`
        UPDATE scan_results
        SET consent_simulation_json = ?,
            tracking_before_consent = ?
        WHERE audit_id = ?
      `);

      updateStmt.run(
        JSON.stringify(consentSimulation),
        trackingCookiesInReject.length > 0 ? 1 : 0,
        auditId
      );

      console.log(`   ✅ Consent simulation data updated in database`);
    } else {
      // Insert new scan_results
      const scanStmt = db.prepare(`
        INSERT INTO scan_results (
          audit_id,
          cookies_json,
          network_requests_json,
          tracking_before_consent,
          consent_simulation_json,
          scan_duration_seconds,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      scanStmt.run(
        auditId,
        JSON.stringify(cookiesAfterReject),
        JSON.stringify([]), // Network requests not yet implemented
        trackingCookiesInReject.length > 0 ? 1 : 0,
        JSON.stringify(consentSimulation),
        0
      );

      console.log(`   ✅ Consent simulation data saved to database`);
    }

    // ============================================
    // KEEP AUDIT IN PAUSED STATE
    // ============================================
    // DO NOT mark as completed here!
    // Resume endpoint will handle status update and continue to Step 17

    console.log(`   ✅ Consent data uploaded for audit ${auditUid}`);
    console.log(`   ⏸️  Audit remains PAUSED - waiting for Resume button click`);
    console.log('');

    // Return success response
    res.status(200).json({
      success: true,
      audit_id: auditUid,
      message: 'Manual consent data uploaded successfully',
      report_url: `/api/audit/${auditUid}/report`,
      data: {
        cookiesAfterReject: cookiesAfterReject.length,
        cookiesAfterAccept: cookiesAfterAccept.length,
        violations: consentSimulation.comparison.violations.length
      }
    });

  } catch (error) {
    console.error('❌ Manual consent upload failed:', error);

    // Update audit status to failed if auditId exists
    if (auditId) {
      try {
        const db = getDatabase();
        const updateStmt = db.prepare(`
          UPDATE audits
          SET status = ?,
              error_message = ?
          WHERE id = ?
        `);
        updateStmt.run(constants.AUDIT_STATUS.FAILED, error.message, auditId);
      } catch (dbError) {
        console.error('Failed to update audit status:', dbError);
      }
    }

    res.status(500).json({
      error: 'Failed to process manual consent data',
      message: error.message,
      code: 'E500'
    });
  }
});

/**
 * Screenshot proxy — streams blob content through server.
 * Blob URL is never exposed to client directly.
 * GET /api/audit/:audit_id/screenshot/:type
 * type: 'full' | 'banner'
 */
router.get('/api/audit/:audit_id/screenshot/:type', async (req, res) => {
  try {
    const { audit_id, type } = req.params;
    if (!['full', 'banner'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type. Must be "full" or "banner".' });
    }

    const db = getDatabase();
    const row = db.prepare(`
      SELECT a.audit_uid, s.screenshot_full_url, s.screenshot_banner_url
      FROM audits a JOIN scan_results s ON s.audit_id = a.id
      WHERE a.audit_uid = ?
    `).get(audit_id);

    if (!row) return res.status(404).json({ error: 'Audit not found' });

    const blobUrl = type === 'full' ? row.screenshot_full_url : row.screenshot_banner_url;
    if (!blobUrl) return res.status(404).json({ error: 'Screenshot not available' });

    // Stream blob content through our server — client never sees blob URL
    const upstream = await fetch(blobUrl);
    if (!upstream.ok) return res.status(502).json({ error: 'Screenshot unavailable' });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    upstream.body.pipe(res);
  } catch (error) {
    console.error('❌ Screenshot proxy failed:', error.message);
    res.status(502).json({ error: 'Screenshot fetch failed' });
  }
});

module.exports = router;
