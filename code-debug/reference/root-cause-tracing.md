# Root Cause Tracing for CraftPolicy

Bugs in CraftPolicy often appear in the report (wrong number, missing section, broken PDF) but originate deep in the scan pipeline — sometimes 5 or more layers back. Your instinct is to fix where you see the problem, but that's treating a symptom.

**Core principle:** Trace backward through the step-runner pipeline until you find the original trigger, then fix at the source.

## When to Use

**Use when:**
- Report shows wrong data but the scan completed "successfully"
- A scan step fails but the error message points to a different module
- You're not sure which of the 17 scan steps produced the wrong data
- A test passes but the real audit shows different results
- NULL values appear in `scan_results` columns unexpectedly

## CraftPolicy Data Flow Map

Every piece of data in the final report follows this path:

```
Puppeteer page → scanner module → context object → saveScanResults() → SQLite → report-data-adapter.js → React component
```

When something is wrong, trace BACKWARD:

```
React component shows wrong data
  ← report-data-adapter.js assembled wrong JSON
    ← SQLite scan_results has wrong/NULL value
      ← saveScanResults() mapped wrong context field
        ← Step function wrote wrong value to context
          ← Scanner/analyzer module computed incorrectly
            ← Input data from Puppeteer page was unexpected
```

**Fix at the earliest point in this chain where the data goes wrong.**

## The Tracing Process — CraftPolicy Examples

### Example 1: Wrong Violation Count

#### 1. Observe the Symptom
Report executive summary says "3 confirmed tracking violations" but you manually counted 7 trackers on the website.

#### 2. Find Immediate Cause
```javascript
// In report-data-adapter.js — where does the number come from?
const metrics = buildMetricHierarchy(scanResults);
// metrics.layer3.count = 3  ← this is the reported number
```

#### 3. Ask: What Called This?
```javascript
// buildMetricHierarchy() is in confirmed-tracking-filter.js
// It reads: scanResults.request_categorization_json
// Layer 3 = Category A + beforeConsent + NOT benign resource + NOT benign extension
```

#### 4. Keep Tracing Up
```bash
# Check the raw data in SQLite:
sqlite3 db.sqlite "SELECT request_categorization_json FROM scan_results WHERE audit_uid='aud_xxx'" | python3 -m json.tool | grep -c '"category": "A"'
# Result: 7 Category A requests exist in the database
```

So 7 requests are Category A, but only 3 pass Layer 3 filters. Why?

```javascript
// Check the SSOT filter conditions:
// - beforeConsent === true → are 4 of the 7 firing AFTER consent? 
// - benign resource type → are any of them CSS/font/image loads?
// - benign extension → are any .woff2, .css, .png?
```

#### 5. Find Original Trigger
```bash
# Check the 4 filtered-out requests:
sqlite3 db.sqlite "SELECT request_categorization_json FROM scan_results WHERE audit_uid='aud_xxx'" 
# Parse and find Category A requests with beforeConsent = false
# Result: 4 requests have beforeConsent = false because the consent banner
#   loaded BEFORE the page finished loading, and the timeline assigned them
#   as "after consent" based on banner appear time
```

**Root cause:** `timeline-builder.js:detectBannerAppearTime()` is detecting the banner appear time too early (before the banner is actually interactive), causing legitimate pre-consent trackers to be classified as post-consent.

**Fix at source:** Adjust `detectBannerAppearTime()`, not the SSOT filter.

---

### Example 2: Report Section Shows NULL

#### 1. Observe the Symptom
The Consent Mode v2 section in the report is empty/null.

#### 2. Find Immediate Cause
```javascript
// In report-data-adapter.js:
const consentMode = scanResults.consent_mode_json;
// consentMode is null
```

#### 3. Ask: What Called This?
```javascript
// In saveScanResults() in website-scanner.js:
consent_mode_json: JSON.stringify(context.consentModeData)
// context.consentModeData is undefined
```

#### 4. Keep Tracing Up
```javascript
// In scan-phase-analysis.js, stepConsentModeDetection:
context.consentModeData = await detectConsentMode(context.page);
// This step is in the PARALLEL BATCH — did it fail silently?
```

#### 5. Find Original Trigger
Check step-runner logs:
```json
{ "event": "parallel_step_settled", "stepName": "stepConsentModeDetection", "status": "rejected", "error": "page.evaluate: Execution context was destroyed" }
```

**Root cause:** Another parallel step navigated away or the page was garbage collected during the parallel batch. The step-runner caught the error via `Promise.allSettled` but the data is lost.

**Fix at source:** Ensure no parallel step modifies page navigation. If this step is fragile, move it to sequential execution after the parallel batch.

---

### Example 3: New Step Produces Empty Data

#### 1. Observe the Symptom
You added a new `stepSecurityHeaders` but the report shows no security header data.

#### 2. Find Immediate Cause
```javascript
// In report-data-adapter.js:
const secHeaders = scanResults.security_headers_json;
// null — column doesn't exist yet
```

#### 3. Trace the chain
- Did you add the column to SQLite? → Check migration file
- Did you add the field to `scan-context.js:createScanContext()`? → Check initialization
- Did you map it in `saveScanResults()`? → Check the context-to-column mapping
- Did `report-data-adapter.js` read the new column? → Check the query

**Typical finding:** 3 out of 4 steps were done, 1 was missed. The data was computed correctly by the step function but never reached the report because one link in the chain was missing.

---

## Adding Diagnostic Logs

When you can't trace manually, add temporary instrumentation:

```javascript
// In any step function — add BEFORE the operation, not after it fails:
const logger = createLogger('debug-trace');

logger.debug({
  event: 'step_input_data',
  stepName: 'stepBannerCompliance',
  contextKeys: Object.keys(context).filter(k => context[k] != null),
  pageUrl: context.page ? context.page.url() : 'NO PAGE',
  cookieCount: context.cookies ? context.cookies.length : 0,
  hasNetworkMonitor: !!context.networkMonitor,
});
```

**Critical rules for diagnostic logs:**
- Use `createLogger()` — never plain `console.log` (Railway logs need structured JSON)
- Log BEFORE the operation, not after failure (the failure may crash before your log)
- Include the `stepName` so you can filter in Railway
- Log the keys that exist on context, not the full data (too large for log output)
- **Remove diagnostic logs after debugging** — they are not permanent

**Checking logs on Railway:**
```
Railway dashboard → Backend service → Logs → Filter: "debug-trace"
```

## Context Object Inspection

When a step produces wrong data, check what the context object looks like at that point:

```javascript
// Temporary — add at the start of the suspicious step function:
async function stepSuspicious(context) {
  const logger = createLogger('debug-context');
  logger.debug({
    event: 'context_snapshot',
    fields: Object.entries(context).map(([k, v]) => ({
      key: k,
      type: v === null ? 'null' : v === undefined ? 'undefined' : Array.isArray(v) ? `array(${v.length})` : typeof v,
    })),
  });
  // ... rest of step
}
```

This tells you exactly which context fields are populated and which are null/undefined at the moment your step runs.

## Database Inspection Commands

```bash
# Check which columns have data for a specific audit:
sqlite3 db.sqlite "
  SELECT 
    audit_uid,
    CASE WHEN cookies_json IS NOT NULL THEN length(cookies_json) ELSE 0 END as cookies_size,
    CASE WHEN request_categorization_json IS NOT NULL THEN length(request_categorization_json) ELSE 0 END as categorization_size,
    CASE WHEN banner_violations_json IS NOT NULL THEN length(banner_violations_json) ELSE 0 END as banner_size,
    CASE WHEN banner_detection_json IS NOT NULL THEN length(banner_detection_json) ELSE 0 END as detection_size,
    CASE WHEN consent_mode_json IS NOT NULL THEN length(consent_mode_json) ELSE 0 END as consent_size,
    CASE WHEN timeline_json IS NOT NULL THEN length(timeline_json) ELSE 0 END as timeline_size
  FROM scan_results 
  WHERE audit_uid = 'AUDIT_UID'
"
```

A `0` size tells you exactly which pipeline step failed to persist data.

## Key Principle

```
Found wrong value in report
  → Can trace one level back?
    → YES: Trace backward, repeat
    → NO: Add diagnostic log, run one audit, check logs
  → Is this the source of the wrong value?
    → YES: Fix at source, run npm test, run audit
    → NO: Keep tracing backward
```

**NEVER fix where the wrong number appears. ALWAYS trace back to where it was calculated.**
