'use strict';
/**
 * Scan Worker — isolated child process for Puppeteer audits
 *
 * Spawned via child_process.fork() by audit.routes.js.
 * Runs scanWebsite() in isolation so a Puppeteer crash or OOM event
 * kills only this worker, not the Express server.
 *
 * IPC protocol:
 *   parent → worker : { websiteUrl, auditId, auditUid }
 *   worker → parent : { type: 'completed' | 'paused' | 'failed', auditId, auditUid, error? }
 */

const { initDatabase, getDatabase } = require('../database/db');
const { scanWebsite } = require('./website-scanner');
const constants = require('../config/constants');
const { createLogger } = require('../utils/logger');

const logger = createLogger('scan-worker');

// Initialise DB connection for this process
initDatabase();

process.on('message', async ({ websiteUrl, auditId, auditUid }) => {
  logger.info('worker-start', { auditId: auditUid, url: websiteUrl, pid: process.pid });

  try {
    const scanResults = await scanWebsite(websiteUrl, auditId, auditUid);

    if (scanResults && scanResults.paused) {
      logger.info('worker-paused', { auditId: auditUid, reason: 'awaiting_manual_consent' });
      process.send({ type: 'paused', auditId, auditUid });
      process.exit(0);
      return;
    }

    // Mark audit completed
    const db = getDatabase();
    db.prepare(`
      UPDATE audits
      SET status = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `).run(constants.AUDIT_STATUS.COMPLETED, auditId);

    logger.info('worker-completed', { auditId: auditUid });
    process.send({ type: 'completed', auditId, auditUid });
    process.exit(0);

  } catch (error) {
    logger.error('worker-failed', {
      auditId: auditUid,
      error: error.message,
      stack: error.stack
    });

    try {
      const db = getDatabase();
      db.prepare(`
        UPDATE audits
        SET status = ?,
            error_message = ?
        WHERE id = ?
      `).run(constants.AUDIT_STATUS.FAILED, error.message, auditId);
    } catch (dbError) {
      logger.error('worker-db-update-failed', { error: dbError.message });
    }

    process.send({ type: 'failed', auditId, auditUid, error: error.message });
    process.exit(1);
  }
});
