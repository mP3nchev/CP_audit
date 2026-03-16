---
name: code-debug
description: CraftPolicy GDPR Auditor debugging. Use for bugs, Puppeteer crashes, banner loading failures, wrong violation counts, Claude API errors, scan pipeline issues, scoring or report problems. # prettier-ignore
---

# Systematic Debugging for CraftPolicy

Random fixes waste time and create new bugs — especially in a legally-sensitive audit tool.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

---

## The Iron Law

```
╔═══════════════════════════════════════════════════════════════╗
║  NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST             ║
║                                                               ║
║  If you haven't completed Phase 1, you cannot propose fixes.  ║
║  This is a GDPR audit tool — wrong output = legal liability.  ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## When to Use

Use for ANY technical issue in CraftPolicy:

- **Scan pipeline failures** — audit stuck in PROCESSING, Puppeteer crash, timeout
- **Wrong numbers** — violation counts differ between scan and report, scoring doesn't match expectations
- **Banner issues** — banner not detected, mobile-only banner, noyb checklist returning all skipped
- **Claude API problems** — budget exceeded, circuit breaker open, policy analysis returning fallback
- **Report problems** — report-v2 showing null/empty sections, PDF generation fails
- **New feature breaks** — adding a new scan step or analyzer causes regressions
- **Test failures** — existing 61 tests breaking after a code change

**Use ESPECIALLY when:**
- Under time pressure (a client audit is pending)
- "Just one quick fix" seems obvious
- You've already asked Claude Code to try multiple fixes
- The bug involves numbers that appear in the final audit report

---

## System Architecture Quick Reference

When debugging, know where you are in the pipeline:

```
audit.routes.js (API entry)
  → website-scanner.js (orchestrator, ~573 lines)
    → step-runner.js (executes steps sequentially or parallel)
      → scan-phase-browser.js (Steps 1–6.6: Puppeteer launch, navigation, cookies)
      → scan-phase-analysis.js (Steps 7–13.7: banner check, categorization, timeline)
        └─ PARALLEL BATCH: cookie extraction, banner check, consent mode, metadata, tracking
      → scan-phase-finalize.js (Steps 14–17: DB write, browser close, scoring)
    → scan-context.js (shared state object — 26+ fields)
  → report-data-adapter.js (reads DB → builds report JSON)
    → confirmed-tracking-filter.js (SSOT — Layer 3 violation count)
  → react-report-renderer.js (React → HTML/PDF via Puppeteer)
```

**Key modules to check by bug type:**

| Bug Type | Check These Files First |
|---|---|
| Wrong violation count | `confirmed-tracking-filter.js` → `detection-confidence.js` → `network-request-categorizer.js` |
| Banner not detected | `cookie-banner-checker.js` (waitForBannerVisible, detectBannerWithRetry) |
| Wrong compliance score | `compliance-score-calculator.js` → check input data from `scan_results` |
| Report shows null sections | `report-data-adapter.js` → check if `scan_results` column is NULL |
| Scan hangs/fails | `website-scanner.js` → check which step failed in `progress_json` |
| Claude API error | `claude-api.js` → `circuit-breaker.js` → `budget_tracking` table |
| New step not working | The step's phase file → `scan-context.js` (is the context field initialized?) |

---

## The Four Phases

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix, gather evidence:**

#### Step 1 — Check Railway Logs

This is always your first move. Connect to Railway and filter logs:

```bash
# In Railway dashboard → your backend service → Logs tab
# Or via Railway CLI:
railway logs --tail 100 | grep -i "error\|fail\|warn"
```

**What to look for in CraftPolicy structured logs:**
```json
{ "ts": "2026-...", "level": "error", "module": "step-runner", "event": "step_failed", "stepName": "stepBannerCompliance", "error": "..." }
```

Key fields: `module` tells you which component, `event` tells you what happened, `stepName` tells you which pipeline step.

#### Step 2 — Check Audit Progress

```bash
# Via API (replace AUDIT_UID with the failing audit):
curl https://YOUR-RAILWAY-URL/api/audit/AUDIT_UID/status \
  -H "x-api-key: YOUR_KEY"
```

The `progress_json` field shows exactly which step the audit reached before failing. If it says `"step": "13.6"` with status `"failed"`, the bug is in network categorization.

#### Step 3 — Check the Database

```bash
# Connect to Railway shell and check scan_results:
sqlite3 /path/to/db.sqlite \
  "SELECT audit_uid, 
    CASE WHEN request_categorization_json IS NULL THEN 'NULL' ELSE 'OK' END as categorization,
    CASE WHEN banner_violations_json IS NULL THEN 'NULL' ELSE 'OK' END as banner,
    CASE WHEN banner_detection_json IS NULL THEN 'NULL' ELSE 'OK' END as detection
   FROM scan_results WHERE audit_uid = 'AUDIT_UID'"
```

NULL columns tell you which pipeline step failed to write data.

#### Step 4 — Trace Data Flow Backward

If the report shows a wrong number:
1. What number appears in the report? → Check `report-data-adapter.js` — where does it read this from?
2. Where did that data come from? → Check `scan_results` DB row — what's stored?
3. Who wrote it? → Check `saveScanResults()` in `website-scanner.js` — which context field?
4. Who set that context field? → Check the specific step in the phase file
5. Keep tracing until you find the source of the wrong value

**NEVER fix where the wrong number appears. Trace back to where it was calculated.**

#### Step 5 — Run the Tests

Before touching any code:
```bash
cd backend && npm test
```

If any of the 61 tests fail, the bug may already be in your codebase. Fix the test failure first — it's telling you exactly what broke.

---

### Phase 2: Pattern Analysis (CraftPolicy-specific)

1. **Find working audits** — Check `scan_results` for a recent successful audit. Compare its data with the failing one.
2. **Compare scan_results rows** — Same website, different audit? Compare the JSON columns side-by-side.
3. **Check the context flow** — Open `scan-context.js`. Is the field that should carry data properly initialized? Is it populated by the step that should set it?
4. **Check the step-runner logs** — Do parallel steps show overlapping timestamps? Did one parallel step fail silently?

---

### Phase 3: Hypothesis and Testing

1. **Form a single hypothesis** — "I think the banner detection fails because the CMP loads inside a cross-origin iframe that page.evaluate() cannot access."
2. **Test minimally** — Add ONE diagnostic log line in the suspected function. Deploy. Run one audit. Check logs.
3. **Verify before continuing** — Did the log confirm your hypothesis? If yes → Phase 4. If no → new hypothesis.
4. **When you don't know** — Say "I don't know yet, I need more data" rather than guessing.

**Diagnostic log example (add temporarily, remove after debugging):**
```javascript
// In cookie-banner-checker.js, inside waitForBannerVisible:
logger.debug({
  event: 'banner_detection_attempt',
  found: !!bannerElement,
  selector: matchedSelector,
  viewport: page.viewport(),
  iframeCount: await page.$$eval('iframe', frames => frames.length),
  url: page.url()
});
```

---

### Phase 4: Implementation

1. **Run the existing test suite first** — `cd backend && npm test` — all 61 must pass
2. **Make ONE change** — not multiple improvements bundled together
3. **Run the tests again** — still 61 passing?
4. **Run a real audit** — `POST /api/audit/start` with a known test URL
5. **Check the output** — violation counts, banner detection status, compliance score

**If fix doesn't work:**
- Count: How many fixes have you tried?
- If < 3: Return to Phase 1 with new information
- If ≥ 3: **STOP and question the architecture**

---

### When 3+ Fixes Fail

Pattern indicating architectural problem:
- Each fix reveals new issues in the step-runner or context flow
- Fixes require changing multiple phase files simultaneously
- Each fix creates new NULL columns in scan_results

**STOP and ask:**
- Is the context object carrying the right data? (Check scan-context.js)
- Is the step in the right phase? (browser vs analysis vs finalize)
- Should this be a new step, or should it modify an existing one?
- Is the confirmed-tracking-filter.js SSOT being bypassed? (Global safety constraint: it must NOT be modified)

---

## CraftPolicy-Specific Debug Flows

### Debug Flow A: Wrong Violation Count in Report

```
Report shows X violations → you expected Y
  │
  ├─ Check report-data-adapter.js → what number does it produce?
  │    └─ It calls buildMetricHierarchy() → check its output
  │
  ├─ Check confirmed-tracking-filter.js → what does Layer 3 return?
  │    └─ It reads request_categorization_json from DB
  │
  ├─ Check scan_results → is request_categorization_json populated?
  │    ├─ NULL → Step 13.6 (stepNetworkCategorization) failed
  │    └─ Has data → compare Category A count vs Layer 3 count
  │         └─ Difference = requests filtered by SSOT rules
  │              (afterConsent, benign types, benign extensions)
  │
  └─ Still wrong? Check detection-confidence.js
       └─ Run the test: npm test -- --test-name-pattern "detection"
```

### Debug Flow B: Banner Not Detected (Most Common Issue)

**Banner/Puppeteer problems are the #1 source of bugs in CraftPolicy.**
**→ See [puppeteer-banner-debug.md](reference/puppeteer-banner-debug.md) for the full 7-section diagnostic guide.**

Quick start — check `banner_detection_json` in `scan_results`:

```
NULL                              → Section 1 (step crashed)
"found": false                    → Section 2 (5 possible causes — check in order)
"found": true, viewport: mobile   → Section 3 (mobile-only banner)
"found": true, all checks skipped → Section 4 (banner disappeared before checks)
"found": true, wrong results      → Section 5 (wrong elements found)
Audit stuck in PROCESSING         → Section 6 (Puppeteer hang)
Need to add a new CMP             → Section 7 (selector list update)
```

### Debug Flow C: New Feature/Step Breaks Existing Functionality

```
Added a new step → existing audit output changed
  │
  ├─ Run: cd backend && npm test
  │    └─ Tests fail? The new step modified shared state incorrectly
  │    └─ Tests pass? The issue is in data flow, not logic
  │
  ├─ Check: does the new step write to a context field 
  │   that another step also writes to?
  │    └─ Two steps writing to same context key = data race in parallel batch
  │    └─ Fix: use a unique context key for the new step
  │
  ├─ Check: is the new step in the right phase?
  │    └─ Does it need the browser? → scan-phase-browser.js
  │    └─ Does it read the page? → scan-phase-analysis.js
  │    └─ Does it run after browser close? → scan-phase-finalize.js
  │
  ├─ Check: is the context field initialized in scan-context.js?
  │    └─ If createScanContext() doesn't initialize it → undefined at runtime
  │
  └─ Check: is saveScanResults() mapping the new context field to a DB column?
       └─ If not → data is computed but never persisted → NULL in reports
```

---

## Red Flags — STOP and Follow Process

- "Quick fix for now, investigate later"
- "Just try changing this and see if it works"
- "I don't understand why it's wrong but this might fix it"
- Proposing changes to confirmed-tracking-filter.js (SSOT — must not be modified)
- Changing multiple phase files in the same commit
- "One more fix attempt" (when already tried 2+)

**ALL of these mean:** STOP. Return to Phase 1.

---

## How to Ask Claude Code to Debug

When you ask Claude Code to investigate a bug, structure your request like this:

```
The audit for [URL] shows [wrong behavior].

1. Check Railway logs for the audit with uid [AUDIT_UID]
2. Check scan_results in the database for NULL columns
3. Check progress_json to see which step failed
4. Trace the data backward from the report to the scan step
5. Tell me what you found BEFORE proposing any fix

DO NOT attempt fixes until you report the root cause.
```

---

## Integration

**Use with:**
- `npm test` — run the 61 existing tests before and after any change
- [defense-in-depth.md](reference/defense-in-depth.md) — add validation at every layer when fixing a bug
- [root-cause-tracing.md](reference/root-cause-tracing.md) — detailed tracing techniques for CraftPolicy

---

## Reference

- **[puppeteer-banner-debug.md](reference/puppeteer-banner-debug.md) — PRIMARY: Puppeteer & banner debugging (7 sections covering every banner failure type)**
- [defense-in-depth.md](reference/defense-in-depth.md) - Multi-layer validation patterns adapted for CraftPolicy
- [root-cause-tracing.md](reference/root-cause-tracing.md) - Detailed tracing through the step-runner pipeline
