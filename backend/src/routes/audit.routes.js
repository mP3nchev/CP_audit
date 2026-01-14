const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/db');
const { scanWebsite } = require('../scanners/website-scanner');
const constants = require('../config/constants');
const crypto = require('crypto');

/**
 * Start a new audit
 * POST /api/audit/start
 * Body: { website_url: string }
 */
router.post('/api/audit/start', async (req, res) => {
  let auditId = null;

  try {
    const { website_url } = req.body;

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

    // Generate unique audit ID
    const auditUid = `aud_${crypto.randomBytes(8).toString('hex')}`;

    // Create audit record
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO audits (audit_uid, website_url, status, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `);

    const result = stmt.run(auditUid, website_url, constants.AUDIT_STATUS.PROCESSING);
    auditId = result.lastInsertRowid;

    console.log(`📝 Created audit: ${auditUid} (ID: ${auditId})`);

    // Start scanning asynchronously
    scanWebsite(website_url, auditId, auditUid)
      .then(scanResults => {
        // Update audit status to completed
        const updateStmt = db.prepare(`
          UPDATE audits
          SET status = ?,
              completed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ?
        `);
        updateStmt.run(constants.AUDIT_STATUS.COMPLETED, auditId);

        console.log(`✅ Audit ${auditUid} completed successfully`);
      })
      .catch(error => {
        // Update audit status to failed
        const updateStmt = db.prepare(`
          UPDATE audits
          SET status = ?,
              error_message = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `);
        updateStmt.run(
          constants.AUDIT_STATUS.FAILED,
          error.message,
          auditId
        );

        console.error(`❌ Audit ${auditUid} failed:`, error.message);
      });

    // Return immediate response
    res.status(200).json({
      audit_id: auditUid,
      status: 'processing',
      created_at: new Date().toISOString(),
      estimated_duration: '3-5 minutes',
      message: 'Audit started successfully'
    });

  } catch (error) {
    console.error('❌ Failed to start audit:', error);

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
        console.error('Failed to update audit status:', dbError);
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

    const response = {
      audit_id: audit.audit_uid,
      website_url: audit.website_url,
      status: audit.status,
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

module.exports = router;
