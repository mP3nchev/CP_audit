# Request ID Correlation Guide

## Overview

The **Request ID** system enables end-to-end tracing of requests across all logs in Railway. Every HTTP request receives a unique ID that's automatically included in all log entries during that request's lifecycle.

## Features

- ✅ **Automatic ID generation** - Unique IDs for every request
- ✅ **Client ID reuse** - Honors `X-Request-ID` header from clients/load balancers
- ✅ **AsyncLocalStorage** - Works across async operations without manual passing
- ✅ **Logger integration** - Automatically injected into all structured logs
- ✅ **Response headers** - Request ID returned to client for reference
- ✅ **Railway searchable** - Filter all logs for a single request

## Request ID Format

```
req_[timestamp]_[random]
```

**Example:** `req_1709234567890_a3f9c2`

## Usage

### 1. Automatic Inclusion (Default)

Request IDs are **automatically included** in all logger calls:

```javascript
const { createLogger } = require('../utils/logger');
const logger = createLogger('service-name');

// In any Express route handler:
app.post('/api/audit', async (req, res) => {
  logger.info('audit-start', { auditId, url });
  // ✅ requestId automatically included
  // Output: {"ts":"...","service":"service-name","level":"info","event":"audit-start","requestId":"req_1709234567890_a3f9c2","auditId":"...","url":"..."}
});
```

### 2. Manual Access (When Needed)

Get request ID explicitly:

```javascript
const { getRequestId } = require('../middleware/requestId');

app.get('/api/status', (req, res) => {
  const requestId = getRequestId(req);

  res.json({
    status: 'ok',
    requestId
  });
});
```

### 3. Client-Side Tracking

Clients can:
- **Send** their own ID via `X-Request-ID` header (preserved across services)
- **Receive** generated ID from `X-Request-ID` response header

```javascript
// Client sends request with custom ID
fetch('/api/audit', {
  headers: {
    'X-Request-ID': 'client_correlation_id_123'
  }
});

// Server reuses this ID in all logs and returns it
// Response includes: X-Request-ID: client_correlation_id_123
```

## Railway Search Examples

### Trace Single Request

```
requestId: "req_1709234567890_a3f9c2"
```

See all logs for this specific request across all services.

### Find Failed Requests

```
level: "error" requestId: *
```

All errors with their request IDs for investigation.

### Audit Trail by Request

```
requestId: "req_*" event: "audit-*" | sort by ts
```

Chronological audit lifecycle for requests.

### Service-Specific Request Errors

```
service: "website-scanner" level: "error" requestId: *
```

All scanner errors with correlation IDs.

## Integration Status

### ✅ Already Integrated

- `/backend/src/middleware/requestId.js` - Middleware implementation
- `/backend/src/utils/logger.js` - Auto-injection enabled
- `/backend/src/server.js` - Middleware registered globally

### 📝 Usage in Routes (Example)

```javascript
// backend/src/routes/audit.routes.js
const { createLogger } = require('../utils/logger');
const { getRequestId } = require('../middleware/requestId');
const logger = createLogger('audit-routes');

router.post('/new', async (req, res) => {
  const requestId = getRequestId(req); // Optional - already auto-included

  logger.info('audit-requested', {
    url: req.body.url,
    userId: req.user?.id
  });
  // Output includes requestId automatically

  try {
    const result = await createAudit(req.body);
    logger.info('audit-completed', { auditId: result.id });
    res.json(result);
  } catch (error) {
    logger.error('audit-failed', { error: error.message });
    // ❌ This error log includes requestId - easy to trace back
    res.status(500).json({ error: 'Audit failed' });
  }
});
```

## Benefits

### 1. **Debugging Made Easy**

When a user reports an error:
1. Check response headers for `X-Request-ID`
2. Search Railway logs: `requestId: "req_..."`
3. See **all logs** from that request (scanner, analyzers, routes, etc.)

### 2. **Performance Analysis**

```
requestId: "req_1709234567890_a3f9c2" | sort by ts
```

See exact timeline:
- Request received: `12:34:56.001`
- Scanner started: `12:34:56.102`
- Analyzer finished: `12:34:58.456`
- Response sent: `12:34:58.500`

Total: 2.5 seconds

### 3. **Production Monitoring**

Alert on patterns:
```
level: "error" requestId: * | count by event
```

Which errors occur most frequently?

### 4. **Compliance Audits**

Prove request handling:
```
auditId: "abc123" requestId: *
```

Full trail: Who requested? When? What happened? Any errors?

## Architecture

```
┌─────────────────┐
│   Client        │
│  (sends         │
│ X-Request-ID?)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  requestIdMiddleware            │
│  - Generate or reuse ID         │
│  - Store in AsyncLocalStorage   │
│  - Add to req.requestId         │
│  - Set response header          │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Route Handlers                 │
│  - Call logger.info/warn/error  │
│  - requestId auto-included      │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Logger (utils/logger.js)       │
│  - Calls getRequestId()         │
│  - Injects into JSON output     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Railway Logs                   │
│  {"requestId":"req_..."}        │
│  Searchable & Filterable        │
└─────────────────────────────────┘
```

## AsyncLocalStorage Magic

Node.js `AsyncLocalStorage` propagates context across async operations **automatically**:

```javascript
app.post('/api/audit', async (req, res) => {
  // requestId stored in AsyncLocalStorage by middleware

  logger.info('step-1'); // ✅ Has requestId

  await someAsyncFunction();
  logger.info('step-2'); // ✅ Still has requestId

  await anotherFunction();
  logger.info('step-3'); // ✅ Still has requestId
});

async function someAsyncFunction() {
  logger.info('inside-async'); // ✅ Has requestId (no manual passing needed)
}
```

**No need to pass `requestId` manually** - it "follows" the async call chain.

## Testing

### Manual Test

```bash
curl -H "X-Request-ID: test_123" http://localhost:3001/api/health
```

Check response headers:
```
X-Request-ID: test_123
```

Check Railway logs:
```
{"requestId":"test_123","event":"health-check","...}
```

### Load Balancer Integration

If using a load balancer that sends `X-Request-ID`:
- ✅ Server reuses that ID
- ✅ Correlation works across multiple services
- ✅ End-to-end tracing from edge to database

## Migration Notes

### Phase 2 Complete
- ✅ Middleware created
- ✅ Logger updated
- ✅ Server integrated
- ✅ Documentation complete

### Next Steps (Optional)
- Explicitly pass `requestId` to external API calls for cross-service tracing
- Add `requestId` to database audit tables for persistent correlation
- Include `requestId` in email notifications for support ticket matching

## Troubleshooting

### Request ID not appearing in logs?

1. **Check middleware order** - `requestIdMiddleware` must be registered **before** routes
2. **Verify logger usage** - Using `createLogger()` not `console.log`
3. **Check AsyncLocalStorage** - Node.js 12.17+ required

### Different IDs in same request?

- Likely using `console.log` instead of logger in some places
- Ensure all logs use `createLogger()` methods

### Client ID not preserved?

- Check header name: `X-Request-ID` (case-insensitive)
- Alternative: `X-Correlation-ID` also supported

## Summary

**Request ID correlation is now LIVE** in your backend:

1. ✅ Every request gets unique ID
2. ✅ All logs include `requestId` automatically
3. ✅ Railway search: `requestId: "req_..."`
4. ✅ Full request lifecycle visible
5. ✅ Production debugging simplified

**No code changes needed** in existing routes - just works!
