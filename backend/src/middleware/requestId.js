/**
 * Request ID Middleware
 *
 * Generates unique request IDs for correlation across logs.
 * Integrates with structured logger for request tracing.
 *
 * Usage:
 *   const { requestIdMiddleware, getRequestId } = require('./middleware/requestId');
 *   app.use(requestIdMiddleware);
 *
 *   // In any route handler:
 *   const requestId = getRequestId(req);
 *   logger.info('event-name', { requestId, ...data });
 */

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

// AsyncLocalStorage for request context (Node.js 12.17+)
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Generate unique request ID
 * Format: req_[timestamp]_[random]
 * Example: req_1709234567890_a3f9c2
 */
function generateRequestId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(3).toString('hex');
  return `req_${timestamp}_${random}`;
}

/**
 * Express middleware to attach request ID
 * - Reuses existing X-Request-ID header if present
 * - Generates new ID if not present
 * - Stores in AsyncLocalStorage for automatic propagation
 * - Adds to response headers for client tracking
 */
function requestIdMiddleware(req, res, next) {
  // Check for existing request ID from client/load balancer
  const existingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const requestId = existingId || generateRequestId();

  // Store in AsyncLocalStorage (automatically propagates to all async operations)
  asyncLocalStorage.run({ requestId }, () => {
    // Also attach to req object for backwards compatibility
    req.requestId = requestId;

    // Send request ID back to client in response headers
    res.setHeader('X-Request-ID', requestId);

    next();
  });
}

/**
 * Get current request ID from AsyncLocalStorage or req object
 * Works in any async context within the request lifecycle
 *
 * @param {Request} req - Express request object (optional - used as fallback)
 * @returns {string|null} Request ID or null if not in request context
 */
function getRequestId(req = null) {
  // Try AsyncLocalStorage first (works anywhere in async chain)
  const store = asyncLocalStorage.getStore();
  if (store && store.requestId) {
    return store.requestId;
  }

  // Fallback to req object if provided
  if (req && req.requestId) {
    return req.requestId;
  }

  return null;
}

/**
 * Get AsyncLocalStorage instance (for advanced use cases)
 * Allows direct access to request context storage
 */
function getAsyncLocalStorage() {
  return asyncLocalStorage;
}

module.exports = {
  requestIdMiddleware,
  getRequestId,
  generateRequestId,
  getAsyncLocalStorage
};
