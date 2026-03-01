'use strict';

/**
 * Centralized Structured Logger
 *
 * Provides consistent JSON logging across all modules for easy Railway log filtering.
 * Automatically includes requestId for request correlation (when requestId middleware is loaded).
 *
 * Usage:
 *   const { createLogger } = require('./utils/logger');
 *   const logger = createLogger('service-name');
 *   logger.info('scan-start', { auditId, url });
 *   logger.error('api-timeout', { error: err.message, auditId });
 *
 * Output format:
 *   {"ts":"2026-02-28T12:34:56.789Z","service":"audit","level":"info","event":"scan-start","requestId":"req_1709234567890_a3f9c2","auditId":"abc123","url":"..."}
 *
 * Railway search examples:
 *   - Filter by service:  service: "audit"
 *   - Filter by level:    level: "error"
 *   - Filter by audit:    auditId: "abc123"
 *   - Filter by event:    event: "budget-exceeded"
 *   - Filter by request:  requestId: "req_1709234567890_a3f9c2"
 *   - Trace full request: requestId: "req_*" | sort by ts
 */

/**
 * Write structured JSON log to stdout
 * @param {string} service - Service/module name (e.g., 'audit', 'claude-api', 'scanner')
 * @param {string} level - Log level (info, warn, error, debug)
 * @param {string} event - Event identifier (e.g., 'budget-exceeded', 'scan-start')
 * @param {Object} context - Additional context data (auditId, url, error, etc.)
 */
function log(service, level, event, context = {}) {
  // Auto-inject requestId if available (from requestId middleware)
  let requestId = context.requestId;
  if (!requestId) {
    try {
      const { getRequestId } = require('../middleware/requestId');
      requestId = getRequestId();
    } catch (e) {
      // Middleware not loaded yet or unavailable - skip requestId
    }
  }

  const logEntry = {
    ts: new Date().toISOString(),
    service,
    level,
    event,
    ...(requestId && { requestId }), // Only add if present
    ...context
  };

  // Write to stdout (Railway aggregates this)
  process.stdout.write(JSON.stringify(logEntry) + '\n');
}

/**
 * Create a logger bound to a specific service
 * @param {string} service - Service name
 * @returns {Object} Logger instance with info/warn/error/debug methods
 */
function createLogger(service) {
  return {
    info: (event, context = {}) => log(service, 'info', event, context),
    warn: (event, context = {}) => log(service, 'warn', event, context),
    error: (event, context = {}) => log(service, 'error', event, context),
    debug: (event, context = {}) => log(service, 'debug', event, context)
  };
}

/**
 * Global logger (use when module context unclear)
 */
const globalLogger = createLogger('app');

module.exports = {
  log,
  createLogger,
  info: globalLogger.info,
  warn: globalLogger.warn,
  error: globalLogger.error,
  debug: globalLogger.debug
};
