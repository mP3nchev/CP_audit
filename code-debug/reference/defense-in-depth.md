# Defense-in-Depth Validation for CraftPolicy

When you fix a bug in the audit pipeline, adding one check feels sufficient. But CraftPolicy has multiple code paths that can reach the same function — the scan pipeline, the report generator, the step-runner, parallel execution. A single validation can be bypassed.

**Core principle:** Validate at EVERY layer data passes through. Make the bug structurally impossible.

## Why Multiple Layers in CraftPolicy

CraftPolicy data flows through 4+ layers before reaching the report:
```
Puppeteer → step function → context object → saveScanResults → SQLite → report-data-adapter → React
```

A bug at any layer produces wrong output. Defending at one point leaves all other points open.

Single validation: "We fixed where it crashed"
Multiple layers: "We made it impossible for bad data to reach the report"

## The Four Layers — CraftPolicy Adapted

### Layer 1: Step Function Input Validation

Every step function should reject obviously invalid input from the context object.

```javascript
// In scan-phase-analysis.js — at the start of any step:
async function stepBannerCompliance(context) {
  // Layer 1: reject if prerequisites are missing
  if (!context.page) {
    throw new Error('stepBannerCompliance: context.page is null — browser step may have failed');
  }
  if (!context.auditId) {
    throw new Error('stepBannerCompliance: context.auditId is required');
  }
  
  // Safe to proceed — page exists and we know which audit this is
  const bannerResult = await analyzeCookieBanner(context.page, context.auditId, context.cookies);
  context.bannerAnalysis = bannerResult;
}
```

**What this catches:** A prior step failed silently, leaving context.page as null. Without Layer 1, the step calls `analyzeCookieBanner(null, ...)` which produces a cryptic Puppeteer error deep in the call stack.

### Layer 2: Business Logic Validation

Ensure computed values make sense for the audit domain.

```javascript
// In compliance-score-calculator.js:
function calculateComplianceScore(bannerData, policyData, technicalData, cookieData) {
  const score = (bannerWeight * bannerScore) + (policyWeight * policyScore) + 
                (techWeight * techScore) + (cookieWeight * cookieScore);
  
  // Layer 2: business logic sanity check
  if (score < 0 || score > 100) {
    logger.error({
      event: 'score_out_of_range',
      score,
      components: { bannerScore, policyScore, techScore, cookieScore },
      weights: { bannerWeight, policyWeight, techWeight, cookieWeight }
    });
    // Clamp to valid range but log the error — this should never happen
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  
  return Math.round(score);
}
```

```javascript
// In confirmed-tracking-filter.js (or its callers):
// Layer 2: SSOT metric hierarchy must be monotonically decreasing
if (metrics.layer3.count > metrics.layer2.count) {
  logger.error({
    event: 'ssot_violation',
    message: 'Layer 3 count exceeds Layer 2 — filter logic error',
    layer2: metrics.layer2.count,
    layer3: metrics.layer3.count,
  });
}
```

**What this catches:** A code change inadvertently alters scoring weights or filter logic, producing impossible values. The business logic layer catches it before the number reaches the report.

### Layer 3: Database Persistence Validation

Ensure data written to SQLite is complete and valid.

```javascript
// In saveScanResults() in website-scanner.js:
function saveScanResults(context) {
  // Layer 3: validate before writing to DB
  const requiredFields = [
    'cookies', 'trackingRequests', 'bannerAnalysis', 
    'requestCategorization', 'timelineData'
  ];
  
  const missingFields = requiredFields.filter(f => context[f] == null);
  
  if (missingFields.length > 0) {
    logger.warn({
      event: 'incomplete_scan_results',
      auditUid: context.auditUid,
      missingFields,
      message: 'Some scan data is missing — partial results will be saved'
    });
  }
  
  // Proceed with save — partial data is better than no data
  // But the warning in logs tells us which step failed
  db.prepare(`INSERT INTO scan_results (...) VALUES (...)`).run({
    cookies_json: context.cookies ? JSON.stringify(context.cookies) : null,
    // ... other fields
  });
}
```

**What this catches:** A parallel step failed and its data is null. Without Layer 3, saveScanResults writes NULL silently. With Layer 3, we know exactly which fields are missing and which steps to investigate.

### Layer 4: Report Generation Validation

Before building the final report, verify the data makes sense.

```javascript
// In report-data-adapter.js:
function adaptAuditDataToReportModel(auditUid) {
  const scanResults = db.prepare('SELECT * FROM scan_results WHERE audit_uid = ?').get(auditUid);
  
  // Layer 4: validate report input data
  if (!scanResults) {
    logger.error({ event: 'report_no_scan_results', auditUid });
    throw new Error(`No scan results found for audit ${auditUid}`);
  }
  
  // Check critical columns
  if (!scanResults.request_categorization_json) {
    logger.warn({
      event: 'report_missing_categorization',
      auditUid,
      message: 'Network categorization data is missing — violation counts will be zero'
    });
  }
  
  if (!scanResults.banner_detection_json) {
    logger.warn({
      event: 'report_missing_banner_detection',
      auditUid,
      message: 'Banner detection data is missing — using legacy banner analysis'
    });
  }
  
  // Build report with available data, logging gaps
  const metrics = buildMetricHierarchy(scanResults);
  // ...
}
```

**What this catches:** Partial scan results from a failed pipeline still produce a report, but the report generator logs exactly which sections will be incomplete. When you check Railway logs, you see `report_missing_categorization` and know exactly where to look.

## Applying the Pattern to Common CraftPolicy Bugs

### Bug: New scan step data doesn't appear in report

Four layers to add when integrating a new step:

```
Layer 1 (step function):    Validate context inputs exist before computing
Layer 2 (business logic):   Validate computed result is within expected range
Layer 3 (saveScanResults):  Map the context field to a DB column, warn if null
Layer 4 (report adapter):   Read the new column, warn if missing, handle gracefully
```

### Bug: Parallel step fails and corrupts other steps' data

Four layers to prevent:

```
Layer 1 (step function):    Check context.page is still valid (not destroyed)
Layer 2 (step-runner):      Promise.allSettled catches rejection without aborting siblings
Layer 3 (saveScanResults):  Log which fields are null after parallel batch
Layer 4 (report adapter):   Handle null columns gracefully, don't crash on missing data
```

### Bug: SSOT violation count changes unexpectedly

Four layers to protect:

```
Layer 1 (categorizer):      Log raw Category A/B/C counts at step 13.6
Layer 2 (SSOT filter):      Assert layer3.count <= layer2.count <= layer1.count
Layer 3 (saveScanResults):  Store both raw and filtered counts for comparison
Layer 4 (report adapter):   Compare stored counts — if mismatch, log warning
```

## New Feature Checklist — Defense-in-Depth

When adding any new audit feature (scan step, analyzer, report section), add ALL four layers:

```
□ Layer 1: Step function validates its context inputs
□ Layer 2: Business logic validates computed output is sane
□ Layer 3: saveScanResults() maps the new context field to a DB column
□ Layer 4: report-data-adapter.js reads the column and handles null gracefully
□ BONUS: scan-context.js initializes the new field (not undefined)
□ BONUS: A test in backend/test/ verifies the new logic with known inputs
```

If you skip any layer, you're leaving a hole that a future bug will exploit.

## Key Insight for CraftPolicy

All four layers are especially important because:
- **Parallel execution** means one step can fail while others succeed → Layer 3 catches partial data
- **Puppeteer is flaky** by nature (timeouts, navigation errors, page destroyed) → Layer 1 catches missing browser state
- **The output is legally cited** → Layer 2 catches impossible values before they appear in a compliance report
- **Claude Code adds new features frequently** → Layer 4 ensures the report doesn't crash on missing data from features added after existing audits were created

**Don't stop at one validation point.** Add checks at every layer.
