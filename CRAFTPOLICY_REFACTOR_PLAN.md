# CraftPolicy GDPR Auditor — Refactor & Implementation Plan

**Generated from:** CraftPolicy Second Technical Evaluation (March 2026)
**Target executor:** AI coding agent with full codebase access
**Repository:** `CP_audit/`
**Execution model:** Sequential atomic commits. Each commit must leave the system runnable.
**Total estimated commits:** 25
**Dependency order:** Issue 5 (Banner) → Issue 1 (Decompose) → Issue 4 (Parallelize) → Issue 2 (Tests) → Issue 3 (Legacy Removal)

> **Critical constraint:** Issues 1 and 4 are coupled — parallelization depends on the step-runner pattern from Issue 1. Issue 2 (tests) should be written AFTER the step-runner refactor so tests target the final interfaces. Issue 3 (legacy removal) must be last because other changes may temporarily rely on the legacy report path as a fallback.

---

# Issue 1: Decompose Scanner Orchestrator into Step-Runner Pattern

## Architectural Goal

Replace the monolithic `scanWebsite()` function (~980 lines, 17 steps, 16 imports) in `backend/src/scanners/website-scanner.js` with a **step-runner** architecture where:

- Each numbered step is a standalone async function in its own file
- A central runner iterates through a step registry, calling each step with a shared context object
- Each step receives context (including the Puppeteer `page`, `browser`, `auditId`, `auditUid`, accumulated results) and returns its output
- Errors in any step are caught per-step, logged with structured logging, and stored as partial results
- The runner persists partial results to SQLite after each major phase boundary (not after every step — that would be excessive I/O)
- Progress tracking (`updateProgress()`) is called by the runner, not by individual steps

## Refactor Strategy

1. Define the shared context interface as a plain JS object (no class)
2. Extract each step into a function with signature `async function(context) → result`
3. Group steps into 3 files by phase (browser-scan, analysis, post-scan) to avoid 17 tiny files
4. Build the runner as a simple `for...of` loop with try/catch per step
5. Keep the existing `scanWebsite()` function signature unchanged — the runner lives inside it
6. Migrate steps one-at-a-time: extract → test manually → next step

---

## Commit Plan

### Commit 1 — Define step context interface and step registry structure

**Purpose:**
Create the data structures that all subsequent extractions will use. No behavioral changes.

**Changes:**
- Create new file `backend/src/scanners/scan-context.js` exporting:
  - `createScanContext(auditId, auditUid, websiteUrl)` — factory function returning the shared context object
  - Context shape: `{ auditId, auditUid, websiteUrl, browser, page, networkMonitor, consentMonitor, cookies, trackingRequests, bannerAnalysis, consentModeData, timelineData, requestCategorization, vendors, metadata, scanResults, errors: [], startTime }`
- Create new file `backend/src/scanners/step-runner.js` exporting:
  - `async runSteps(steps, context, updateProgressFn)` — iterates `steps` array, calls each `step.execute(context)`, catches errors per-step, calls `updateProgressFn` after each step
  - Each step entry: `{ name: string, stepNumber: string, execute: async function(context), critical: boolean }`
  - If `critical: true` and step throws, runner aborts remaining steps
  - If `critical: false` and step throws, runner logs error to `context.errors[]` and continues
  - Runner returns `{ completed: boolean, stepsRun: number, errors: context.errors }`

**Files Likely Affected:**
- `backend/src/scanners/scan-context.js` (NEW)
- `backend/src/scanners/step-runner.js` (NEW)

**Implementation Notes:**
- Do NOT import anything from `website-scanner.js` yet
- Do NOT use classes — plain objects and functions only
- The `steps` array is ordered — execution is sequential (parallelization comes in Issue 4)
- Use `createLogger('step-runner')` for structured logging
- Each step's error is stored as `{ stepName, stepNumber, error: error.message, stack: error.stack }`

**Validation:**
- Both files import without errors: `node -e "require('./backend/src/scanners/scan-context.js'); require('./backend/src/scanners/step-runner.js')"`
- `runSteps` with an empty array returns `{ completed: true, stepsRun: 0, errors: [] }`

---

### Commit 2 — Extract Phase 1 browser setup steps (Steps 1–6.6) into scan-phase-browser.js

**Purpose:**
Move the browser launch, navigation, monitoring injection, cookie snapshots, and stability waits into discrete step functions.

**Changes:**
- Create `backend/src/scanners/scan-phase-browser.js` exporting an array of step objects:
  - `stepBrowserLaunch` (Step 1): launches Puppeteer via `puppeteer-setup.js`, stores `browser` and `page` on context
  - `stepInjectMonitoring` (Step 1 continued): calls `consent-monitor.js` injection and `network-monitor.js` setup on `context.page`
  - `stepNavigate` (Step 1 continued): navigates to `context.websiteUrl` with timeout handling
  - `stepImmediateCookieSnapshot` (Step 5.5): calls `cookie-extractor.js` immediate extraction
  - `stepAsyncCookieWait` (Step 5.7): 5-second wait + intermediate cookie snapshot
  - `stepPageStability` (Step 6): 3-second stability wait
  - `stepConsentModeWait` (Step 6.6): polls for `window.google_tag_data.ics` (15s max)
  - `stepBannerDetection` (Step 6.5): calls `timeline-builder.js:detectBannerAppearTime()`
- Each function reads from and writes to `context` — no return value merging needed
- Mark `stepBrowserLaunch` and `stepNavigate` as `critical: true`
- All others are `critical: false`

**Files Likely Affected:**
- `backend/src/scanners/scan-phase-browser.js` (NEW)
- `backend/src/scanners/website-scanner.js` (read-only reference — DO NOT MODIFY YET)

**Implementation Notes:**
- Copy the exact logic from `website-scanner.js` Steps 1–6.6 into the new functions
- Preserve all existing logging calls (`logger.info`, `logger.warn`, `logger.error`)
- Do NOT change `puppeteer-setup.js`, `network-monitor.js`, `consent-monitor.js`, `cookie-extractor.js`, or `timeline-builder.js` — call them with the same arguments as the original code
- Each step function receives the full `context` object. It reads what it needs and writes its outputs back to `context`
- For `stepBrowserLaunch`: set `context.browser` and `context.page`
- For `stepInjectMonitoring`: set `context.networkMonitor` and `context.consentMonitor`
- For cookie steps: append to `context.cookies` object

**Validation:**
- File imports without errors
- Each exported step has `name`, `stepNumber`, `execute`, `critical` properties
- No references to variables outside the function scope (no closures over scanner state)

---

### Commit 3 — Extract Phase 1 analysis steps (Steps 7–13.7) into scan-phase-analysis.js

**Purpose:**
Move all in-browser analysis (cookie extraction, banner check, consent mode, network categorization, timeline, vendor fingerprinting, correlation) into step functions.

**Changes:**
- Create `backend/src/scanners/scan-phase-analysis.js` exporting step objects:
  - `stepFinalCookieExtraction` (Step 7): three-tier timestamp cookie extraction
  - `stepPreliminaryNetworkStats` (Step 8): `networkMonitor.getTrackingRequests()` — preliminary count
  - `stepClientSideTracking` (Step 9): `tracking-detector.js` extraction
  - `stepBannerCompliance` (Step 10): `cookie-banner-checker.js:analyzeCookieBanner()`
  - `stepConsentMonitorData` (Step 10.4): consent monitoring extraction + vendor fingerprinting
  - `stepConsentModeDetection` (Step 10.5): `consent-mode-detector.js:detectConsentMode()`
  - `stepConsentModeValidation` (Step 10.6): `consent-mode-validator.js` validation
  - `stepPageMetadata` (Step 13): `puppeteer-setup.js:getPageMetadata()`
  - `stepTimelineConstruction` (Step 13.5): `timeline-builder.js:buildTimeline()`
  - `stepNetworkCategorization` (Step 13.6): 5-layer confidence scoring — **CRITICAL:** this step REPLACES `context.trackingRequests` with the re-categorized set
  - `stepNetworkStorageCorrelation` (Step 13.7): `correlateNetworkAndStorage()` — NOTE: this function is currently inline in `website-scanner.js`. Extract it as a named function in this file.
- Mark `stepNetworkCategorization` as `critical: true` (it produces the SSOT input data)
- All others are `critical: false`

**Files Likely Affected:**
- `backend/src/scanners/scan-phase-analysis.js` (NEW)
- `backend/src/scanners/website-scanner.js` (read-only reference for copying logic)

**Implementation Notes:**
- `correlateNetworkAndStorage()` is currently an inline function in `website-scanner.js`. Copy it verbatim into `scan-phase-analysis.js` as a module-level helper. It must receive network requests and storage writes from context and write correlation results back to context.
- Step 13.6 is the critical reassignment: `context.trackingRequests = requestCategorization.trackingRequests`. Ensure this happens.
- `stepBannerCompliance` calls `analyzeCookieBanner(context.page, context.auditId, context.cookies)` — all three arguments come from context.

**Validation:**
- File imports without errors
- All step objects have correct structure
- `correlateNetworkAndStorage` is a pure function (no external state)

---

### Commit 4 — Extract post-browser steps (Steps 14–17) into scan-phase-finalize.js

**Purpose:**
Move database persistence, browser close, consent simulation, and compliance scoring into step functions.

**Changes:**
- Create `backend/src/scanners/scan-phase-finalize.js` exporting step objects:
  - `stepPersistScanResults` (Step 14): `saveScanResults()` — writes all context data to `scan_results` table
  - `stepCloseBrowser` (Step 15): `closeBrowser(context.browser)`
  - `stepConsentSimulation` (Step 16): `consent-simulator-v1.js` — respects `SKIP_CONSENT_CHECK` env var
  - `stepComplianceScore` (Step 17): `compliance-score-calculator.js` — writes to `audits.overall_score`
- Mark `stepPersistScanResults` and `stepComplianceScore` as `critical: true`
- `stepCloseBrowser` is `critical: false` (best-effort cleanup)
- `stepConsentSimulation` is `critical: false` (currently skipped in production)

**Files Likely Affected:**
- `backend/src/scanners/scan-phase-finalize.js` (NEW)

**Implementation Notes:**
- `stepPersistScanResults` must assemble the same 14 JSON blob columns currently written by `saveScanResults()` in the original scanner. Copy the column mapping exactly.
- `stepCloseBrowser` must handle the case where `context.browser` is null (if browser launch failed in an earlier step)
- `stepConsentSimulation` must check `process.env.SKIP_CONSENT_CHECK === 'true'` and return `{ skipped: true }` if set

**Validation:**
- File imports without errors
- All step objects have correct structure

---

### Commit 5a — Map saveScanResults() parameter interface from local variables to context object

**Purpose:**
This is the highest-risk operation in the entire plan. Before wiring the step-runner, we must first understand and document EXACTLY which local variables `saveScanResults()` reads, then refactor it to accept a `context` object instead. This commit changes ONLY `saveScanResults()` — the rest of `scanWebsite()` continues to work as before.

**⚠️ MANDATORY PRE-WORK — DO NOT SKIP:**
Before writing ANY code, the agent MUST execute this analysis:

1. Open `backend/src/scanners/website-scanner.js`
2. Find the `saveScanResults()` function definition
3. List EVERY local variable it reads — write them down as a complete list
4. For each variable, find WHERE in `scanWebsite()` it is assigned (which step number)
5. Create a mapping document as a code comment at the top of `saveScanResults()`:
   ```js
   /*
    * CONTEXT FIELD MAPPING (generated during refactor):
    * saveScanResults reads → context key → assigned in step
    * ─────────────────────────────────────────────────────
    * cookies           → context.cookies           → Step 7
    * trackingRequests  → context.trackingRequests   → Step 13.6
    * bannerAnalysis    → context.bannerAnalysis     → Step 10
    * ... (COMPLETE LIST — every single variable)
    */
   ```
6. Only AFTER this mapping is complete and verified, proceed with the code change.

**Changes:**
- In `website-scanner.js`, refactor `saveScanResults()` to accept a single `context` parameter:
  - Old signature: `saveScanResults(auditId, cookies, trackingRequests, bannerAnalysis, ...)` (or reads from closure variables)
  - New signature: `saveScanResults(context)`
  - Inside the function, replace every local variable reference with `context.variableName`
- At the EXISTING call site inside `scanWebsite()` (the old inline code), create a temporary context object that maps the old local variables:
  ```js
  // TEMPORARY bridge — will be removed when step-runner is wired
  const tempContext = {
    auditId,
    cookies,
    trackingRequests,
    bannerAnalysis,
    // ... every field from the mapping above
  };
  saveScanResults(tempContext);
  ```
- This means: old code still runs exactly as before, but `saveScanResults` now reads from a context object

**Files Likely Affected:**
- `backend/src/scanners/website-scanner.js` (modify `saveScanResults()` and its call site)

**Implementation Notes:**
- The mapping comment is NOT optional — it is the primary deliverable of this commit
- If `saveScanResults()` reads from closure variables (outer scope of `scanWebsite()`), the agent must identify ALL of them
- Count the context fields. If the count is less than 10, something is missing — `scan_results` has 14 JSON blob columns
- After refactoring, the `tempContext` bridge ensures zero behavioral change
- DO NOT touch any other part of `scanWebsite()` in this commit

**Validation:**
- Server starts without errors
- Trigger an audit — it completes successfully
- Compare the `scan_results` row BEFORE and AFTER this commit for the same test URL — all 14 JSON columns must contain equivalent data
- The mapping comment at the top of `saveScanResults()` lists at least 14 fields

---

### Commit 5b — Refactor updateProgress() to accept step metadata from runner

**Purpose:**
Make `updateProgress()` compatible with the step-runner's callback interface without breaking the existing inline calls.

**⚠️ MANDATORY PRE-WORK — DO NOT SKIP:**
1. Open `website-scanner.js` and find ALL calls to `updateProgress()`
2. Document the current call signature: what arguments does it receive?
3. Document the `progress_json` format that the frontend polls — what fields does it expect?
4. Only then proceed.

**Changes:**
- Modify `updateProgress()` to accept either the old call format OR a step object from the runner:
  ```js
  function updateProgress(auditId, stepInfo) {
    // Accept both old format (string/number) and new format (step object)
    const stepNumber = typeof stepInfo === 'object' ? stepInfo.stepNumber : stepInfo;
    const stepName = typeof stepInfo === 'object' ? stepInfo.name : `Step ${stepInfo}`;
    // ... existing progress_json update logic using stepNumber and stepName
  }
  ```
- This is a backward-compatible change — all existing `updateProgress(auditId, 7)` calls still work
- The step-runner will call `updateProgress(auditId, { stepNumber: '7', name: 'stepFinalCookieExtraction' })`

**Files Likely Affected:**
- `backend/src/scanners/website-scanner.js` (modify `updateProgress()` only)

**Implementation Notes:**
- The `progress_json` format stored in SQLite and read by the frontend MUST NOT CHANGE
- If the frontend expects `{ step: 7, total: 17, description: "..." }`, the new code must produce the same shape
- Test by checking the frontend status polling still displays progress correctly

**Validation:**
- Server starts without errors
- Trigger an audit — progress updates appear in `GET /api/audit/:id/status` with the same format as before
- Frontend (if accessible) displays progress correctly

---

### Commit 5c — Wire step-runner into scanWebsite() — CONTROLLED CUTOVER

**Purpose:**
Replace the monolithic body of `scanWebsite()` with the step-runner. This is now safe because `saveScanResults(context)` and `updateProgress()` are already compatible.

**Changes:**
- In `backend/src/scanners/website-scanner.js`:
  - Import `createScanContext` from `scan-context.js`
  - Import `runSteps` from `step-runner.js`
  - Import step arrays from `scan-phase-browser.js`, `scan-phase-analysis.js`, `scan-phase-finalize.js`
  - Replace the body of `scanWebsite(url, auditId, auditUid)` with:
    ```js
    const context = createScanContext(auditId, auditUid, url);
    const allSteps = [...browserSteps, ...analysisSteps, ...finalizeSteps];
    const result = await runSteps(allSteps, context, (stepInfo) => updateProgress(auditId, stepInfo));

    if (!result.completed) {
      logger.error({ event: 'scan_incomplete', auditUid, errors: result.errors });
    }
    ```
  - Remove the old inline step code (Steps 1–17 body) — it is replaced by the step functions in phase files
  - Remove the `tempContext` bridge from Commit 5a — `saveScanResults(context)` now receives the real context populated by the step-runner
  - Keep `updateProgress()` and `saveScanResults()` in this file
  - The function signature `scanWebsite(url, auditId, auditUid)` MUST NOT CHANGE
  - The `.then()/.catch()` caller in `audit.routes.js` MUST NOT CHANGE

**⚠️ MANDATORY PRE-WORK — DO NOT SKIP:**
1. Open the `saveScanResults()` mapping comment from Commit 5a
2. Open `scan-context.js` and verify that `createScanContext()` initializes ALL fields listed in the mapping
3. Open each phase file and verify that each field is SET by exactly one step
4. If any field in the mapping is NOT set by any step, the cutover will produce null columns — FIX before proceeding

**Files Likely Affected:**
- `backend/src/scanners/website-scanner.js` (body of `scanWebsite()` shrinks from ~980 lines to ~15 lines)

**Implementation Notes:**
- The old inline step code should be DELETED, not commented out
- The `require()` statements for individual scanner/analyzer modules should be removed from this file (they now live in the phase files)
- After this commit, `website-scanner.js` should contain only: imports of step-runner/context/phases, `scanWebsite()` (15 lines), `updateProgress()`, `saveScanResults(context)`

**Validation:**
- Start the backend server: `npm start` — server starts without errors
- Trigger an audit via `POST /api/audit/start` with a test URL
- Poll `GET /api/audit/:id/status` — progress_json updates appear for each step
- Audit reaches `completed` status (not hanging, not `failed` unless the test site has issues)
- `GET /api/audit/:id/report-v2` returns a valid report with non-null violation counts
- Check `scan_results` row — all 14 JSON columns are populated (no unexpected nulls)
- Structured logs show step-runner entries with step names, durations, and any non-critical errors

---

### Commit 5d — Verify data integrity: compare pre-refactor and post-refactor audit output

**Purpose:**
Run the same audit on the same URL before and after the cutover and verify the outputs match. This is a verification commit, not a code change.

**Changes:**
- Create `backend/test/verify-refactor-output.js` (temporary test script):
  ```js
  // This script compares two scan_results rows by audit_uid
  // Run: node test/verify-refactor-output.js <pre_refactor_uid> <post_refactor_uid>
  // It loads both rows from SQLite and compares all JSON columns
  // Reports: MATCH / MISMATCH per column with diff details
  ```
- The script should:
  1. Load both `scan_results` rows by audit_uid
  2. For each of the 14 JSON columns: parse both, deep-compare keys and array lengths
  3. Report per-column: MATCH, MISMATCH (with details), or NULL (if column is null in either)
  4. Acceptable differences: timestamps, request timing values (these will differ between runs)
  5. Unacceptable differences: violation counts, category assignments, cookie classifications, banner check results

**Files Likely Affected:**
- `backend/test/verify-refactor-output.js` (NEW — temporary verification script)

**Implementation Notes:**
- This script is for one-time verification. It can be deleted after confirming parity.
- The agent should run an audit on a known test URL BEFORE the cutover (Commit 5c), note the audit_uid, then run the same URL AFTER, and compare.
- If mismatches are found in violation counts or category assignments, the cutover has a bug that must be fixed before proceeding to Commit 6.

**Validation:**
- Script runs without errors
- All violation-related columns show MATCH
- If MISMATCH is found in critical columns, DO NOT proceed to Commit 6 — fix the phase files first

---

### Commit 6 — Clean up: remove dead code from website-scanner.js

**Purpose:**
Remove any remaining inline step code, unused imports, and TODO comments from the refactored file.

**Changes:**
- In `website-scanner.js`: remove any commented-out code blocks from the old steps
- Remove unused `require()` statements (the phase files now own those imports)
- Verify no orphaned helper functions remain that are only used by extracted steps
- Update the module-level JSDoc comment to describe the new architecture

**Files Likely Affected:**
- `backend/src/scanners/website-scanner.js`

**Validation:**
- `website-scanner.js` is under 100 lines
- All `require()` statements are used
- Server starts and audit completes successfully

---

## Safety Constraints

- DO NOT change the `scanWebsite(url, auditId, auditUid)` function signature
- DO NOT change the `audit.routes.js` caller — the fire-and-forget `.then()/.catch()` pattern must remain
- DO NOT introduce async/await at the route level (the fire-and-forget pattern is intentional)
- DO NOT change the SQLite schema or the `scan_results` column structure
- DO NOT change the `progress_json` format — the frontend polls it
- DO NOT move `saveScanResults()` or `updateProgress()` out of `website-scanner.js` until after all steps are verified working
- DO NOT introduce a new framework, dependency, or class hierarchy

## Final Validation Checklist

- [ ] `website-scanner.js` is under 100 lines
- [ ] `saveScanResults()` has a complete field mapping comment listing all 14+ context fields (Commit 5a)
- [ ] `updateProgress()` accepts both old format and step-runner format (Commit 5b)
- [ ] All 17 scan steps execute in the correct order
- [ ] `progress_json` updates are visible via `/api/audit/:id/status`
- [ ] A complete audit produces the same `scan_results` row as before the refactor (verified via Commit 5d)
- [ ] `context.errors[]` captures non-critical step failures without aborting
- [ ] Critical step failures (browser launch, navigation, categorization, persistence, scoring) abort the pipeline
- [ ] Structured logs show step names and execution durations

---

# Issue 2: Add Minimal Test Coverage for Scoring Logic

## Architectural Goal

Create a test suite using Node.js built-in test runner (`node:test`) covering the three modules that produce legally-cited outputs:

1. `confirmed-tracking-filter.js` — the SSOT for violation counts
2. `compliance-score-calculator.js` — the overall compliance score and grade
3. `detection-confidence.js` — the 5-layer request classification

No test framework dependencies. No mocking libraries. Pure function input/output validation.

## Refactor Strategy

These three modules process structured data (JSON objects) and return structured results. They are testable by constructing known inputs and asserting expected outputs. The tests should capture the current behavior as a baseline — if any test fails after a future code change, that change may have introduced a regression in legally-sensitive output.

---

## Commit Plan

### Commit 7 — Create test infrastructure and generate fixtures by reading source code

**Purpose:**
Set up the test directory, npm script, and — critically — generate test fixtures that exactly match the real data structures used by the modules under test. The fixtures must be derived from reading the source code, NOT from guessing.

**⚠️ CRITICAL RULE FOR ALL TEST COMMITS (7–10):**
```
╔══════════════════════════════════════════════════════════════════╗
║  NEVER GUESS A DATA STRUCTURE. NEVER ASSUME A FUNCTION          ║
║  SIGNATURE. ALWAYS READ THE SOURCE FILE FIRST.                  ║
║                                                                  ║
║  Before writing ANY test or fixture:                             ║
║  1. Open the source file being tested                            ║
║  2. Find the EXACT function signature (name, parameters, types)  ║
║  3. Find the EXACT input object shape it expects                 ║
║  4. Find the EXACT output object shape it returns                ║
║  5. Find ALL edge cases handled in the code (null checks,        ║
║     fallbacks, special cases)                                    ║
║  6. Only THEN write the test                                     ║
║                                                                  ║
║  If you write a fixture with a field name that doesn't exist     ║
║  in the source code, the test is WRONG even if it passes.        ║
╚══════════════════════════════════════════════════════════════════╝
```

**Changes — Phase 1: Read and document (NO code yet):**

Before creating any files, the agent must read and extract the following information:

1. **Read `backend/src/analyzers/detection-confidence.js`:**
   - Find the main exported function (likely `analyzeRequest`)
   - Document its EXACT parameter shape: what properties does the request object need?
   - Document its EXACT return shape: what properties does the result have?
   - List all property names it reads from the input (e.g., `url`, `headers`, `responseStatus`, `resourceType`, `beforeConsent`, etc.)

2. **Read `backend/src/analyzers/confirmed-tracking-filter.js`:**
   - Find `buildMetricHierarchy` and `computeConfirmedTrackingViolations`
   - Document their EXACT parameter signatures — do they accept a scan_results row? JSON columns? A flat object?
   - Document what fields they read from the input
   - Document the EXACT output shape (layer1, layer2, layer3 — or different names?)

3. **Read `backend/src/analyzers/compliance-score-calculator.js`:**
   - Find the main scoring function
   - Document: does it accept data objects or an `auditId` (database read)?
   - If it reads from the database: which tables and columns?
   - If it accepts objects: what is the exact shape?
   - Document the output shape

4. **Read `backend/src/config/tracking-domains.json`:**
   - Extract 3 real tracking domains to use in fixtures

5. **Read `backend/src/config/vendor-patterns.json`:**
   - Extract 3 real vendor URL patterns to use in fixtures

6. **Read `backend/src/scanners/network-monitor.js`:**
   - Find the request object shape that `getRequests()` returns — this is the shape the detection-confidence module will expect

**Changes — Phase 2: Create files based on documented structures:**

- Create directory `backend/test/`
- Create `backend/test/fixtures/`
- Add to `backend/package.json` scripts: `"test": "node --test test/**/*.test.js"`
- Create `backend/test/fixtures/README.md` with the full documentation from Phase 1 (function signatures, input shapes, output shapes) — this serves as a reference for all test commits
- Create `backend/test/fixtures/sample-requests.js`:
  - Every request object must have EXACTLY the fields documented in Phase 1 from `network-monitor.js` and `detection-confidence.js`
  - Export `knownTrackingRequests` — 5 requests using REAL domains from `tracking-domains.json` and REAL paths from `vendor-patterns.json`:
    - Google Analytics `/collect` request with full query params (`v=1&tid=UA-XXX&cid=123&t=pageview`)
    - Facebook `/tr` pixel with `id` and `ev` params
    - Hotjar request with `hj` params
    - DoubleClick `/pagead/` request
    - LinkedIn Insight Tag request
  - Export `knownBenignRequests` — 5 requests:
    - Same-origin CSS file: `https://example.com/style.css`
    - Font file: `https://fonts.gstatic.com/s/roboto/v30/font.woff2`
    - Same-origin API call: `https://example.com/api/products`
    - Same-origin image: `https://example.com/logo.png`
    - CDN JavaScript (non-tracking): `https://cdnjs.cloudflare.com/ajax/libs/lodash/4.17.21/lodash.min.js`
  - Export `knownConsentPings` — 2 requests with `gcs` and `gcd` parameters in the URL
  - Export `knownBlockedRequests` — 2 requests with `responseStatus: 0` and `failed: true`
  - ALL requests must have `beforeConsent: true` for tracking, `beforeConsent: false` for benign (unless testing SSOT filtering)

- Create `backend/test/fixtures/sample-scan-results.js`:
  - The shape of this fixture must EXACTLY match what `confirmed-tracking-filter.js` expects as input (documented in Phase 1)
  - Include a `request_categorization_json` with Category A, B, and C arrays where each item matches the REAL categorizer output shape
  - Include a `cookies` array matching the REAL cookie-extractor output shape
  - Include a `bannerAnalysis` object matching the REAL banner-checker output shape
  - Include a `policyAnalysis` object matching the REAL policy-analyzer output shape
  - If `compliance-score-calculator.js` reads from the database, also create `backend/test/fixtures/test-db-helper.js` that:
    - Creates an in-memory SQLite database
    - Applies the schema from `backend/src/database/schema.sql`
    - Provides `insertFixtureAudit(data)` and `cleanup()` functions

**Files Likely Affected:**
- `backend/package.json` (modify)
- `backend/test/fixtures/README.md` (NEW — function signature documentation)
- `backend/test/fixtures/sample-requests.js` (NEW)
- `backend/test/fixtures/sample-scan-results.js` (NEW)
- `backend/test/fixtures/test-db-helper.js` (NEW — only if compliance-score-calculator reads from DB)

**Implementation Notes:**
- The `README.md` in fixtures/ is the SINGLE SOURCE OF TRUTH for all test commits. If a function signature is wrong in README.md, all tests will be wrong. So verify it carefully.
- Run each fixture file through `node -e "const f = require('./backend/test/fixtures/sample-requests.js'); console.log(Object.keys(f))"` to verify it exports correctly
- If ANY field name in a fixture does not exist in the source module, the fixture is WRONG — fix it before proceeding

**Validation:**
- `cd backend && npm test` runs without errors (no test files yet, but the runner executes)
- `backend/test/fixtures/README.md` contains documented function signatures for all 3 modules
- Each fixture file imports without errors
- Each request in `knownTrackingRequests` has ALL fields that `detection-confidence.js` reads (verified against README.md)

---

### Commit 8 — Tests for detection-confidence.js (5-layer scoring)

**Purpose:**
Verify that the 5-layer scoring engine correctly classifies known tracking, benign, consent ping, and blocked requests.

**⚠️ MANDATORY PRE-WORK — DO NOT SKIP:**
1. Open `backend/test/fixtures/README.md` — re-read the documented function signature for `detection-confidence.js`
2. Open `backend/src/analyzers/detection-confidence.js` — read the ENTIRE file top to bottom
3. Find the main exported function. Write down:
   - Exact function name: ____________________
   - Exact parameters: ____________________
   - Exact return object shape: ____________________
   - Does it need a single request or an array of requests?
   - Does it need additional context (e.g., all requests for L3 behavioral analysis)?
   - What does it return for consent pings? (boolean flag? low score? explicit exclusion?)
4. Find all `if/else` branches and edge cases in the function — these become test cases
5. Only AFTER completing steps 1–4, write the test file

**Changes:**
- Create `backend/test/detection-confidence.test.js`
- At the TOP of the file, add a comment block documenting what you found in steps 1–4:
  ```js
  /*
   * FUNCTION UNDER TEST: <exact function name>
   * SIGNATURE: <exact signature>
   * INPUT SHAPE: { <exact fields> }
   * OUTPUT SHAPE: { <exact fields> }
   * EDGE CASES FOUND: <list>
   * SOURCE: backend/src/analyzers/detection-confidence.js
   */
  ```
- Import the function using the EXACT export name (not a guessed name)
- Import fixtures from `./fixtures/sample-requests.js`
- Test cases:
  1. **Known tracking requests score ≥70 (Category A):** For each request in `knownTrackingRequests`, call the function and assert `result.confidence >= 70` (or whatever the field name is — use the REAL field name from step 3)
  2. **Known benign requests score <40 (Category C):** For each in `knownBenignRequests`, assert score < 40
  3. **Consent pings are excluded:** For each in `knownConsentPings`, assert the function returns the exclusion indicator found in step 3
  4. **Blocked requests are excluded:** For requests with `responseStatus: 0`, assert Category C classification
  5. **Score components are present:** Assert the result contains all 5 layer scores (use REAL field names from the source)
  6. **Score is deterministic:** Call the function twice with identical input, assert `JSON.stringify(result1) === JSON.stringify(result2)`
  7. **Edge case: request with no URL params** — empty query string should not crash
  8. **Edge case: request with unknown domain** — should produce low confidence, not an error

**Files Likely Affected:**
- `backend/test/detection-confidence.test.js` (NEW)

**Implementation Notes:**
- If the function expects a property called `requestUrl` but your fixture uses `url`, the test will pass with wrong data (the function will see `undefined` and produce a default score). This is the #1 source of false-positive tests. VERIFY FIELD NAMES.
- If the function requires additional context beyond a single request (e.g., all captured requests for behavioral L3 analysis), wrap the test to provide that context
- If the function is not directly exported (e.g., it's a method on an object or wrapped in another function), trace the export chain and call the correct entry point
- Run each test case individually first: `node --test --test-name-pattern "tracking" test/detection-confidence.test.js`

**Validation:**
- `cd backend && npm test` — all tests pass
- At least 10 test assertions
- The comment block at the top of the test file matches the ACTUAL function signature (verify manually)
- No test uses a field name that doesn't exist in the source module

---

### Commit 9 — Tests for confirmed-tracking-filter.js (SSOT)

**Purpose:**
Verify that the three-layer metric hierarchy correctly filters from raw counts to confirmed violations.

**⚠️ MANDATORY PRE-WORK — DO NOT SKIP:**
1. Open `backend/src/analyzers/confirmed-tracking-filter.js` — read the ENTIRE file
2. Find ALL exported functions. For each one, document:
   - Exact function name
   - Exact parameter list and types
   - What data structure does each parameter expect? (Is it a scan_results DB row? A parsed JSON object? Multiple separate arguments?)
   - Exact return object shape with all property names
3. Find the SSOT filtering logic: what conditions must a request satisfy to be Layer 3?
   - `beforeConsent === true` — confirmed or different field name?
   - Category A check — how is category determined? By `confidence >= 70` or by a `category` string field?
   - Benign resource type exclusion — what is the exact list of excluded types?
   - Benign extension exclusion — what is the exact list?
   - Tracking pixel exception — what are the exact conditions?
4. Find the fallback logic for `null` or missing `request_categorization_json`
5. Document all of the above in `backend/test/fixtures/README.md` (append to existing content)
6. Only AFTER steps 1–5, write the test file

**Changes:**
- Create `backend/test/confirmed-tracking-filter.test.js`
- At the TOP, add a documentation comment (same format as Commit 8)
- Import functions using their EXACT exported names
- Import fixtures from `./fixtures/sample-scan-results.js`
- Test cases:
  1. **Layer 1 count equals total raw requests:** Verify using the REAL property names from step 2
  2. **Layer 2 count equals Category A + B combined:** Use REAL property names
  3. **Layer 3 count ≤ Layer 2 count**
  4. **Layer 3 excludes afterConsent requests:** Create a Category A request object (using the REAL shape from step 3) with `beforeConsent: false` → must NOT appear in Layer 3
  5. **Layer 3 excludes benign resource types:** Create a Category A request that is a CSS file with `beforeConsent: true` → must NOT be in Layer 3. Use the EXACT resource type string the code checks for (e.g., is it `'stylesheet'`, `'css'`, `'Stylesheet'`? — verify from source)
  6. **Layer 3 excludes benign extensions:** URL ending `.woff2` with `beforeConsent: true` → NOT in Layer 3
  7. **Layer 3 includes tracking pixels:** `.gif` request with `search.length > 10` AND known tracking path → IS in Layer 3. Use the EXACT tracking paths the code checks (found in step 3)
  8. **Layer 3 includes ONLY Category A:** Category B request (confidence 50) with `beforeConsent: true` → NOT in Layer 3
  9. **Empty/null input handling:** Pass empty object, null, and undefined to the function — must return zero counts without throwing
  10. **Legacy fallback path:** If `request_categorization_json` is null, the code should fall back to `req.isTracking` flag — test this path
  11. **Output structure validation:** Assert the returned object has ALL properties documented in step 2 (not just the ones we think should be there)
  12. **funnelExplanation field exists:** Assert it is a non-empty string

**Files Likely Affected:**
- `backend/test/confirmed-tracking-filter.test.js` (NEW)
- `backend/test/fixtures/README.md` (append documentation)

**Implementation Notes:**
- The input format is the MOST LIKELY source of errors. Does `buildMetricHierarchy` accept:
  - `(scanResults)` — a full DB row?
  - `(requestCategorizationJson, allRequests)` — two separate JSON objects?
  - `(auditUid)` — an ID that triggers a DB read?
  - The answer MUST come from reading the source, not guessing.
- If the function reads from the database, you MUST use the `test-db-helper.js` from Commit 7 to set up fixture data
- The test for case 4 (afterConsent exclusion) must construct a request that PASSES all other Layer 3 filters but has `beforeConsent: false` — this isolates the single condition being tested
- Similarly, case 5 must construct a request that passes all filters EXCEPT resource type

**Validation:**
- `cd backend && npm test` — all tests pass
- At least 12 test assertions
- The documentation comment matches the ACTUAL function signatures
- Every fixture request object uses ONLY field names that exist in the source code

---

### Commit 10 — Tests for compliance-score-calculator.js

**Purpose:**
Verify that the compliance score calculation produces correct weighted scores and grade assignments.

**⚠️ MANDATORY PRE-WORK — DO NOT SKIP:**
1. Open `backend/src/analyzers/compliance-score-calculator.js` — read the ENTIRE file
2. Answer these questions by reading the code (not by guessing):
   - What is the main exported function name? ____________________
   - Does it accept DATA OBJECTS or an AUDIT ID (triggering a DB read)? ____________________
   - If data objects: what is the EXACT parameter list? ____________________
   - If audit ID: which tables does it query? Which columns? ____________________
   - What is the EXACT return shape? (e.g., `{ score, grade, components }` or just a number?) ____________________
   - What are the EXACT weight values? (35/30/20/15 or different?) ____________________
   - What are the EXACT grade boundaries? (90=A, 80=B, ... or different thresholds?) ____________________
   - How does weight redistribution work when privacy policy is missing? ____________________
   - How does weight redistribution work when cookie policy is missing? ____________________
3. Document ALL answers in `backend/test/fixtures/README.md` (append)
4. If the function reads from the database:
   - List the EXACT SQL queries (copy them from the source)
   - Verify `test-db-helper.js` creates the right tables
   - Create a `insertComplianceFixtures(db, data)` function in `test-db-helper.js`
5. Only AFTER steps 1–4, write the test file

**Changes:**
- Create `backend/test/compliance-score-calculator.test.js`
- At the TOP, add documentation comment with answers from step 2
- Import the function using its EXACT name

**If the function reads from the database:**
```js
const { createTestDb, insertComplianceFixtures, cleanup } = require('./fixtures/test-db-helper');
// Before each test: set up in-memory DB with fixture data
// After each test: cleanup
```

**If the function accepts data objects:**
```js
const { sampleBannerAnalysis, samplePolicyAnalysis, ... } = require('./fixtures/sample-scan-results');
// Call function directly with fixture data
```

- Test cases:
  1. **Full data produces score 0–100:** Provide complete fixture data, assert `0 <= score <= 100`. Use the REAL return property name (is it `score`, `overall_score`, `totalScore`? — from step 2)
  2. **Grade assignment boundaries:** Test with scores at EXACT boundaries from step 2 (not assumed boundaries). If the code says `score >= 85 → A`, test with 84 and 85, not 89 and 90.
  3. **Weight components sum correctly:** Compute expected score manually from weights found in step 2: `policyWeight * policyScore + bannerWeight * bannerScore + ...` → assert matches function output (within ±1 for rounding)
  4. **Missing privacy policy redistributes weights:** Provide data WITHOUT policy analysis field. Assert: (a) function does not throw, (b) score computes, (c) the ACTUAL redistribution matches the logic found in step 2
  5. **Missing cookie policy redistributes weights:** Same pattern
  6. **Zero violations → high score:** Construct fixture where all components are "passing" → assert score > 80 (or whatever "good" means per the code)
  7. **Maximum violations → low score:** Construct fixture where everything fails → assert score < 30 (or per code)
  8. **Deterministic:** Same input twice → same output
  9. **BANNER_NOT_DETECTED handling (if Issue 5 is already applied):** If the scoring code has been updated for `bannerDetected: false`, test that path. If not yet applied, add a TODO comment for this test case.

**Files Likely Affected:**
- `backend/test/compliance-score-calculator.test.js` (NEW)
- `backend/test/fixtures/README.md` (append documentation)
- `backend/test/fixtures/test-db-helper.js` (modify if DB access needed)

**Implementation Notes:**
- This is the module MOST LIKELY to require database access. If it calls `getDatabase()` internally, the test CANNOT work with pure data objects. The agent MUST detect this by reading the source before choosing the test strategy.
- If the module calls `getDatabase()`, the test-db-helper must:
  1. Create an in-memory SQLite database
  2. Apply the schema from `backend/src/database/schema.sql`
  3. Override the `getDatabase()` singleton to return the test DB (this may require the module to accept a `db` parameter, or a `NODE_ENV=test` check)
  4. If `getDatabase()` cannot be overridden without modifying source code, create a THIN wrapper test that:
     - Sets up a real SQLite file in `/tmp/test-compliance-XXXX.db`
     - Applies schema
     - Inserts fixture data
     - Runs the function
     - Deletes the file
- DO NOT skip this module because "it's too complex to test" — it produces the client-facing compliance score and grade. Find a way.

**Validation:**
- `cd backend && npm test` — all tests pass
- At least 8 test assertions
- Grade boundaries in the test match the ACTUAL boundaries in the source code
- Weight values in the test match the ACTUAL weights in the source code
- Documentation comment confirms whether DB access or pure function approach was used

---

## Safety Constraints

- DO NOT add any test framework dependency (no Jest, Mocha, Vitest)
- Use ONLY `node:test` and `node:assert`
- DO NOT modify any source files — tests must work with the existing code
- DO NOT mock the file system, network, or Puppeteer — test only pure analytical functions
- If a function requires database access, create a fresh in-memory SQLite for the test, do NOT connect to the production database
- **NEVER GUESS A FUNCTION SIGNATURE** — always read the source file and document the signature in a comment before writing ANY test code
- **NEVER ASSUME A FIELD NAME** — if the source uses `requestUrl` and you write `url` in a fixture, the test is silently wrong
- **ALWAYS document what you read** — every test file must have a header comment with the exact function signature and data shapes found in the source

## Final Validation Checklist

- [ ] `cd backend && npm test` runs all tests and passes
- [ ] At least 30 total test assertions across 3 test files
- [ ] `backend/test/fixtures/README.md` contains documented function signatures for ALL 3 modules under test
- [ ] Every test file has a header comment documenting the function signature, input shape, and output shape
- [ ] Every field name used in fixtures exists in the corresponding source module (grep to verify)
- [ ] Tests cover: known tracking → Category A, known benign → Category C, consent pings excluded, SSOT Layer 3 filter logic, compliance score boundaries, weight redistribution
- [ ] No new dependencies added to `package.json`
- [ ] Tests are deterministic (no time-dependent, network-dependent, or random behavior)
- [ ] Grade boundaries in compliance tests match the ACTUAL code, not assumed values
- [ ] Weight values in compliance tests match the ACTUAL code, not assumed values

---

# Issue 3: Consolidate to Single Report Path (React v2) — Remove Handlebars Legacy

## Architectural Goal

After this issue is resolved:
- The ONLY report generation path is: `report-data-adapter.js` → JSON → React frontend → `react-report-renderer.js` → HTML/PDF
- `html-report-builder.js` is deleted
- The Handlebars template `templates/gdpr-report-template.html` is deleted
- `GET /api/audit/:id/report` either returns 410 Gone or redirects to `/api/audit/:id/report-v2`
- `buildMetricHierarchy()` from `confirmed-tracking-filter.js` is called ONLY from `report-data-adapter.js`

## Refactor Strategy

Safe removal in 3 phases:
1. Add deprecation (redirect the legacy route)
2. Verify React path covers all data previously only in Handlebars path
3. Delete legacy files

---

## Commit Plan

### Commit 11 — Audit data parity between legacy and React report paths

**Purpose:**
Identify any data or sections present in `html-report-builder.js` that are NOT present in `report-data-adapter.js`. Document any gaps before deletion.

**Changes:**
- Create `backend/REPORT_PARITY_AUDIT.md` documenting:
  - List every data field assembled by `html-report-builder.js:gatherAuditData()` and `transformDataForTemplate()`
  - For each field, note whether `report-data-adapter.js:adaptAuditDataToReportModel()` includes equivalent data
  - Flag any fields present ONLY in the legacy path
- If gaps are found, add the missing data fields to `report-data-adapter.js`

**Files Likely Affected:**
- `backend/REPORT_PARITY_AUDIT.md` (NEW — temporary documentation)
- `backend/src/generators/report-data-adapter.js` (possibly modified to add missing fields)

**Implementation Notes:**
- The agent must READ both files fully before writing the parity audit
- Pay special attention to: `buildMetricHierarchy()` call, `gdpr-precedents-search.js` call, risk assessment data, compliance score data
- If `html-report-builder.js` calls `buildMetricHierarchy()` and `report-data-adapter.js` also calls it — that's parity
- If `html-report-builder.js` includes data that `report-data-adapter.js` does not, add it to the adapter

**Validation:**
- `REPORT_PARITY_AUDIT.md` exists and lists all fields
- If fields were added to `report-data-adapter.js`, verify `GET /api/audit/:id/report-v2` returns the new fields

---

### Commit 12 — Redirect legacy report route to React v2

**Purpose:**
Make `GET /api/audit/:id/report` redirect to the React v2 path instead of rendering Handlebars HTML.

**Changes:**
- In `backend/src/routes/audit.routes.js`:
  - Find the handler for `GET /api/audit/:id/report`
  - Replace the handler body with:
    ```js
    res.redirect(301, `/api/audit/${req.params.id}/report-v2`);
    ```
  - Add a structured log entry: `logger.info({ event: 'legacy_report_redirect', auditUid: req.params.id })`
- Do NOT delete `html-report-builder.js` yet — only the route is redirected

**Files Likely Affected:**
- `backend/src/routes/audit.routes.js`

**Implementation Notes:**
- The redirect must use the same URL parameter (`:id`) as the original route
- If the frontend has any hardcoded references to `/api/audit/:id/report` (without `-v2`), search for them and update
- Check `frontend/app/` for any page that calls the legacy endpoint

**Validation:**
- `curl -v http://localhost:PORT/api/audit/VALID_UID/report` returns HTTP 301 with Location header pointing to `/report-v2`
- The React v2 report renders correctly when accessed via the redirect

---

### Commit 13 — Remove html-report-builder.js and Handlebars template

**Purpose:**
Delete the legacy report generation code.

**Changes:**
- Delete `backend/src/generators/html-report-builder.js`
- Delete `backend/templates/gdpr-report-template.html`
- In `backend/src/routes/audit.routes.js`: remove the import of `html-report-builder.js` if it's still imported
- In any other file that imports `html-report-builder.js`: remove the import
- Search the codebase for any reference to `html-report-builder`, `gdpr-report-template`, or `generateReport` (the legacy function name) and remove/update as needed
- Delete `backend/REPORT_PARITY_AUDIT.md` (temporary documentation from Commit 11)

**Files Likely Affected:**
- `backend/src/generators/html-report-builder.js` (DELETE)
- `backend/templates/gdpr-report-template.html` (DELETE)
- `backend/src/routes/audit.routes.js` (remove import)
- `backend/REPORT_PARITY_AUDIT.md` (DELETE)
- Any file referencing `html-report-builder`

**Implementation Notes:**
- Run `grep -r "html-report-builder" backend/` to find all references before deletion
- Run `grep -r "gdpr-report-template" backend/` to find all references
- Run `grep -r "generateReport" backend/src/` to find function references (be careful — this name might be used elsewhere)
- If `confirmed-tracking-filter.js:buildMetricHierarchy()` was imported by the legacy builder, verify it is STILL imported by `report-data-adapter.js`

**Validation:**
- Server starts without errors
- `GET /api/audit/:id/report` returns 301 redirect
- `GET /api/audit/:id/report-v2` returns a valid report
- `grep -r "html-report-builder" backend/` returns zero results
- `grep -r "gdpr-report-template" backend/` returns zero results

---

### Commit 14 — Remove Handlebars dependency from package.json

**Purpose:**
Clean up the dependency tree.

**Changes:**
- Remove `handlebars` from `backend/package.json` dependencies
- Run `npm install` to update `package-lock.json`
- Verify no other module uses Handlebars

**Files Likely Affected:**
- `backend/package.json`
- `backend/package-lock.json`

**Implementation Notes:**
- Run `grep -r "handlebars" backend/src/` to confirm no remaining imports
- Run `grep -r "require.*handlebars" backend/` to double-check

**Validation:**
- `cd backend && npm install` succeeds
- `cd backend && npm start` — server starts without errors
- No module requires `handlebars`

---

## Safety Constraints

- DO NOT delete `html-report-builder.js` before the redirect is in place (Commit 12 before Commit 13)
- DO NOT remove `confirmed-tracking-filter.js` — it is used by the React path
- DO NOT change `report-data-adapter.js` output format — the frontend React components depend on it
- DO NOT remove `react-report-renderer.js` — it is the production path
- DO NOT modify the `/report-v2` route or `report-data-adapter.js` output structure

## Final Validation Checklist

- [ ] `html-report-builder.js` does not exist
- [ ] `gdpr-report-template.html` does not exist
- [ ] `handlebars` is not in `package.json`
- [ ] `GET /api/audit/:id/report` returns 301 redirect to `/report-v2`
- [ ] `GET /api/audit/:id/report-v2` renders the full React report with SSOT metrics
- [ ] `buildMetricHierarchy()` is called from `report-data-adapter.js`
- [ ] Server starts and full audit cycle completes without errors

---

# Issue 4: Parallelize Independent Scanner Steps

## Architectural Goal

Within the step-runner pattern (from Issue 1), certain analysis steps that are read-only on the Puppeteer page and independent of each other run concurrently via `Promise.all`. This reduces Phase 1 scan time by 30–40%.

**Prerequisite:** Issue 1 must be fully completed before starting this issue.

## Refactor Strategy

1. Identify steps that are read-only on `context.page` and do not depend on each other's output
2. Modify the step-runner to support parallel step groups
3. Group independent steps into a single parallel batch

**Independent steps (can run in parallel):**
- Step 7 (Final Cookie Extraction) — reads cookies from page
- Step 9 (Client-Side Tracking Detection) — reads JS objects from page
- Step 10 (Banner Compliance) — reads DOM from page
- Step 10.5 (Consent Mode Detection) — reads JS objects from page
- Step 13 (Page Metadata) — reads DOM metadata from page

**Steps that MUST remain sequential:**
- Step 8 (Preliminary Network Stats) — must run BEFORE Step 13.6 (which replaces its output)
- Step 10.4 (Consent Monitor + Vendor Fingerprinting) — depends on monitoring data accumulated during page load
- Step 10.6 (Consent Mode Validation) — depends on Step 10.5 output
- Step 13.5 (Timeline) — depends on cookies and network data from earlier steps
- Step 13.6 (Network Categorization) — depends on Step 8 output
- Step 13.7 (Correlation) — depends on Steps 13.5 and 13.6 output

---

## Commit Plan

### Commit 15 — Extend step-runner to support parallel step groups

**Purpose:**
Add the ability to define a group of steps that execute concurrently.

**Changes:**
- In `backend/src/scanners/step-runner.js`:
  - Modify the `steps` array to accept two entry types:
    - Sequential step: `{ name, stepNumber, execute, critical }` (existing)
    - Parallel group: `{ parallel: true, steps: [step, step, ...] }`
  - When the runner encounters a parallel group, execute all contained steps with `Promise.allSettled()`
  - For each settled result: if rejected and `critical: true`, mark the group as failed; if rejected and `critical: false`, log to `context.errors[]`
  - Progress reporting for parallel groups: report the group name (e.g., "Parallel Analysis Batch") as a single progress entry

**Files Likely Affected:**
- `backend/src/scanners/step-runner.js`

**Implementation Notes:**
- Use `Promise.allSettled` (not `Promise.all`) to prevent one failing step from aborting siblings
- Each parallel step still receives the same `context` object. Since they are read-only on `context.page`, write conflicts are not expected. However, each step writes to DIFFERENT keys on context (cookies, bannerAnalysis, consentModeData, metadata, trackingData). Verify no two parallel steps write to the same context key.
- If any parallel step is `critical: true` and fails, the runner should abort after the parallel group completes (not mid-execution)

**Validation:**
- Existing sequential execution still works (no parallel groups defined yet)
- Unit test: create 3 mock async steps, wrap in parallel group, verify all 3 execute and their results appear in context

---

### Commit 16 — Group independent analysis steps into parallel batch

**Purpose:**
Configure the step registry in `scan-phase-analysis.js` to run independent steps concurrently.

**Changes:**
- In `backend/src/scanners/scan-phase-analysis.js`:
  - Restructure the exported step array to wrap independent steps in a parallel group:
    ```
    [
      // Sequential: preliminary network stats (needed later)
      stepPreliminaryNetworkStats,
      // Parallel batch: independent page reads
      {
        parallel: true,
        name: 'parallel-analysis-batch',
        steps: [
          stepFinalCookieExtraction,    // Step 7
          stepClientSideTracking,        // Step 9
          stepBannerCompliance,          // Step 10
          stepConsentModeDetection,      // Step 10.5
          stepPageMetadata,              // Step 13
        ]
      },
      // Sequential: steps that depend on parallel batch outputs
      stepConsentMonitorData,           // Step 10.4
      stepConsentModeValidation,        // Step 10.6
      stepTimelineConstruction,         // Step 13.5
      stepNetworkCategorization,        // Step 13.6
      stepNetworkStorageCorrelation,    // Step 13.7
    ]
    ```

**Files Likely Affected:**
- `backend/src/scanners/scan-phase-analysis.js`

**Implementation Notes:**
- `stepPreliminaryNetworkStats` (Step 8) MUST run BEFORE the parallel batch because it reads from `networkMonitor` which is still accumulating
- `stepConsentModeValidation` (Step 10.6) MUST run AFTER `stepConsentModeDetection` (Step 10.5)
- `stepTimelineConstruction` (Step 13.5) MUST run AFTER cookies and network data are available
- `stepNetworkCategorization` (Step 13.6) MUST run AFTER Step 8 because it replaces the preliminary tracking requests
- Verify that `stepBannerCompliance` and `stepConsentModeDetection` both use `context.page` read-only (no navigation, no click events, no DOM modifications)

**Validation:**
- Full audit completes successfully with parallel execution
- Scan time for Phase 1 analysis is measurably shorter (check structured logs for step timings)
- `scan_results` row contains the same data as before parallelization
- Report output is identical

---

## Safety Constraints

- DO NOT parallelize steps that modify the page DOM (navigation, clicks, scrolls)
- DO NOT parallelize steps that write to the SAME context key
- DO NOT parallelize `stepNetworkCategorization` — it replaces `context.trackingRequests` and must run after all reads are complete
- DO NOT parallelize any finalize-phase steps (database write, browser close, scoring)
- Use `Promise.allSettled`, NEVER `Promise.all` (one failure must not abort siblings)

## Final Validation Checklist

- [ ] Full audit completes successfully
- [ ] Parallel batch logs show concurrent execution (overlapping timestamps)
- [ ] Non-parallel steps still execute sequentially
- [ ] `scan_results` output is identical to pre-parallelization
- [ ] Phase 1 scan time is 30–40% shorter for the analysis batch
- [ ] A failure in one parallel step does not prevent other parallel steps from completing

---

# Issue 5: Banner Loading Reliability Fixes

## Architectural Goal

After this issue is resolved:
- `waitForBannerVisible()` returns a structured status object (not just a boolean/void)
- If the banner is not found at desktop viewport, the system retries at mobile viewport (375×812)
- Banner detection status is stored in `scan_results` as a new field
- If no banner is detected at any viewport, the noyb checklist reports "Banner Not Detected" as a distinct finding instead of running individual violation checks on a non-existent banner
- The report surfaces banner rendering failures as a GDPR finding

**This issue should be implemented BEFORE Issue 1** because the banner fix modifies `cookie-banner-checker.js` which will be extracted into a step function in Issue 1. Implementing the fix first means the step extraction captures the correct logic.

---

## Commit Plan

### Commit 17 — Refactor waitForBannerVisible() to return structured status

**Purpose:**
Change the banner detection function from a side-effect logger to a structured return value.

**Changes:**
- In `backend/src/analyzers/cookie-banner-checker.js`:
  - Modify `waitForBannerVisible(page, timeout)` to return:
    ```js
    {
      found: boolean,
      selector: string | null,     // which selector matched
      location: 'main' | 'iframe' | null,
      viewport: 'desktop' | 'mobile',
      timeMs: number               // how long detection took
    }
    ```
  - Currently the function logs a warning on timeout and returns void. Change it to return the status object.
  - On success: `{ found: true, selector: matchedSelector, location: 'main'|'iframe', viewport: 'desktop', timeMs }`
  - On timeout: `{ found: false, selector: null, location: null, viewport: 'desktop', timeMs: timeout }`
  - Keep the existing polling logic and selector list unchanged

**Files Likely Affected:**
- `backend/src/analyzers/cookie-banner-checker.js`

**Implementation Notes:**
- The return type change should NOT break callers — currently the return value is ignored
- Track which selector matched (store it in a variable during the polling loop)
- Track whether the match was in main document or iframe
- Add `const startTime = Date.now()` at function start; compute `timeMs = Date.now() - startTime` at return

**Validation:**
- Server starts without errors
- Existing audit completes — the banner check still executes
- Structured logs show the banner detection status

---

### Commit 18 — Add mobile viewport retry to banner detection

**Purpose:**
If the banner is not found at the desktop viewport, resize to mobile and retry.

**Changes:**
- In `cookie-banner-checker.js`, create a new function `detectBannerWithRetry(page, timeout)`:
  ```js
  async function detectBannerWithRetry(page, timeout) {
    // Try desktop viewport first
    const desktopResult = await waitForBannerVisible(page, timeout);
    if (desktopResult.found) return desktopResult;

    // Retry with mobile viewport
    const originalViewport = page.viewport();
    await page.setViewport({ width: 375, height: 812 });
    // Wait 2 seconds for responsive reflow
    await new Promise(r => setTimeout(r, 2000));

    const mobileResult = await waitForBannerVisible(page, timeout);
    mobileResult.viewport = 'mobile';

    // Restore original viewport
    await page.setViewport(originalViewport);
    // Wait 1 second for reflow back
    await new Promise(r => setTimeout(r, 1000));

    return mobileResult;
  }
  ```
- Modify `analyzeCookieBanner()` to call `detectBannerWithRetry()` instead of `waitForBannerVisible()` directly
- Store the banner detection result in the return object of `analyzeCookieBanner()`

**Files Likely Affected:**
- `backend/src/analyzers/cookie-banner-checker.js`

**Implementation Notes:**
- After mobile detection, ALWAYS restore the original viewport — other steps (metadata, screenshots if re-enabled) depend on the viewport
- The 2-second wait after viewport resize is necessary because CMPs use `window.matchMedia` or `resize` event listeners that fire asynchronously
- If the banner is found ONLY on mobile, set `mobileResult.viewport = 'mobile'` so the report can flag this as a finding
- The `timeout` parameter for the mobile retry should be the same as desktop (10 seconds)
- Total added scan time for the retry path: ~13 seconds (2s reflow + 10s poll + 1s restore). This is acceptable.

**Validation:**
- Audit a site known to have a mobile-only banner: banner is detected on retry
- Audit a site with a desktop banner: banner is detected on first try, no retry occurs
- Audit a site with no banner: both desktop and mobile return `found: false`, total time ~23 seconds

---

### Commit 19 — Gate noyb checks on banner detection status

**Purpose:**
If no banner was detected at any viewport, skip the individual violation checks (type_a through type_k) and report "Banner Not Detected" as the finding.

**Changes:**
- In `cookie-banner-checker.js`, modify `analyzeCookieBanner()`:
  - After calling `detectBannerWithRetry()`, check `bannerStatus.found`
  - If `found === false`:
    ```js
    return {
      bannerDetected: false,
      bannerDetectionStatus: bannerStatus,
      violations: [],
      overallResult: {
        finding: 'BANNER_NOT_DETECTED',
        description: 'No cookie consent banner was detected at desktop or mobile viewports. This is a GDPR violation: no consent mechanism was presented to the user.',
        severity: 'critical',
        gdprArticles: ['Art. 6(1)(a)', 'Art. 7', 'ePrivacy Art. 5(3)'],
      },
      compliancePercentage: 0,
      checksRun: 0,
    };
    ```
  - If `found === true`: proceed with existing violation checks as normal, but add `bannerDetected: true` and `bannerDetectionStatus: bannerStatus` to the return object
  - If `found === true` and `viewport === 'mobile'`: add an additional finding:
    ```js
    {
      type: 'BANNER_MOBILE_ONLY',
      description: 'Cookie consent banner renders only on mobile viewport. Desktop users are not presented with a consent mechanism.',
      severity: 'high',
    }
    ```

**Files Likely Affected:**
- `backend/src/analyzers/cookie-banner-checker.js`

**Implementation Notes:**
- The return shape of `analyzeCookieBanner()` is changing — a new `bannerDetected` field and `bannerDetectionStatus` field are added. Downstream consumers must handle both shapes.
- Check what `website-scanner.js` (or the new step function if Issue 1 is done) does with the banner analysis return value. It should store the full object in `context.bannerAnalysis`.
- Check what `compliance-score-calculator.js` does with banner data — it may need to handle the `BANNER_NOT_DETECTED` case (score the banner component as 0%).
- Check what `report-data-adapter.js` does with `banner_violations_json` — it should surface the `BANNER_NOT_DETECTED` finding in the report.

**Validation:**
- Audit a site with no banner: report shows "Banner Not Detected" finding with critical severity
- Audit a site with a desktop banner: report shows normal noyb checklist results
- Compliance score for a no-banner site: banner component = 0%

---

### Commit 20 — Store banner detection status in scan_results

**Purpose:**
Persist the banner detection metadata for use in report generation and diagnostics.

**Changes:**
- In `backend/src/database/schema.sql` or via a migration: add column `banner_detection_json` to `scan_results` table (TEXT, nullable)
  - Use the guarded ALTER TABLE migration pattern already used in `migrate-add-scoring.js`:
    ```js
    const columns = db.pragma('table_info(scan_results)');
    if (!columns.find(c => c.name === 'banner_detection_json')) {
      db.exec('ALTER TABLE scan_results ADD COLUMN banner_detection_json TEXT');
    }
    ```
- In the scan pipeline (website-scanner.js or stepPersistScanResults): serialize `bannerDetectionStatus` to this column
- In `report-data-adapter.js`: read `banner_detection_json` and include it in the report data model

**Files Likely Affected:**
- `backend/src/database/migrate-add-monitoring.js` (or new migration file)
- `backend/src/scanners/website-scanner.js` (or `scan-phase-finalize.js` if Issue 1 is done)
- `backend/src/generators/report-data-adapter.js`

**Implementation Notes:**
- The migration must be idempotent (guarded by PRAGMA check)
- The column is TEXT storing JSON. The value is the full `bannerDetectionStatus` object from `detectBannerWithRetry()`
- Existing audits will have `null` in this column — `report-data-adapter.js` must handle null gracefully

**Validation:**
- Server starts, migration runs without errors
- New audit stores banner detection JSON in `scan_results`
- `GET /api/audit/:id/report-v2` includes banner detection status in the response
- Old audits with `null` banner_detection_json still render reports correctly

---

### Commit 21 — Update compliance-score-calculator.js to handle BANNER_NOT_DETECTED

**Purpose:**
Ensure the scoring system correctly handles the case where no banner was detected.

**Changes:**
- In `backend/src/analyzers/compliance-score-calculator.js`:
  - When reading banner analysis data, check for `bannerDetected === false`
  - If no banner detected: the banner compliance component (30% weight) scores 0
  - If banner detected only on mobile: the banner compliance component receives a penalty (reduce by 50% from the normal score)

**Files Likely Affected:**
- `backend/src/analyzers/compliance-score-calculator.js`

**Implementation Notes:**
- Read the existing scoring logic carefully to understand how `bannerAnalysis` is consumed
- The banner compliance component currently scores based on the `compliancePercentage` from the noyb checklist. When `BANNER_NOT_DETECTED`, `compliancePercentage` will be `0` — verify this flows through correctly
- The mobile-only case needs explicit handling: `BANNER_MOBILE_ONLY` should reduce the banner score but not zero it (the banner does exist, just not for all users)

**Validation:**
- Audit site with no banner: overall score is low (banner 30% component = 0)
- Audit site with desktop banner: score unchanged from previous behavior
- Tests from Issue 2 (Commit 10) still pass — update fixtures if needed

---

### Commit 22 — Enable type_i noyb check (quick win)

**Purpose:**
Enable the already-implemented `checkMisclassifiedEssentialCookies()` function that is currently hardcoded to skip.

**Changes:**
- In `backend/src/analyzers/cookie-banner-checker.js`:
  - Find the `switch` statement in `checkViolation()`
  - Find `case 'type_i':` which currently returns `{ detected: false, skipped: true, skipReason: '...' }`
  - Replace with a call to `checkMisclassifiedEssentialCookies(cookies, violation)`:
    ```js
    case 'type_i':
      result = checkMisclassifiedEssentialCookies(cookies, violation);
      break;
    ```
  - Verify `cookies` is passed through to `checkViolation()` — trace the parameter chain from `analyzeCookieBanner()` → `checkViolation()`

**Files Likely Affected:**
- `backend/src/analyzers/cookie-banner-checker.js`

**Implementation Notes:**
- The function `checkMisclassifiedEssentialCookies(cookies, violation)` already exists in the same file — do NOT rewrite it
- Verify the function's return shape matches what `checkViolation()` expects: `{ detected: boolean, evidence: object|null }`
- The compliance percentage calculation denominator will change from 7 to 8 active checks (type_i is no longer skipped)
- This changes audit output — existing audits keep their old scores, new audits will include type_i results

**Validation:**
- Audit a site that sets `_ga` or `_fbp` cookies classified as "essential" by the CMP: type_i violation detected
- Audit a site with correctly classified cookies: type_i reports no violation
- Compliance percentage denominator is now 8 (not 7)

---

## Safety Constraints

- DO NOT change the noyb-violations.json configuration format
- DO NOT change the existing selector list in waitForBannerVisible() — only add the retry logic around it
- DO NOT remove any existing violation checks (type_a through type_k)
- DO NOT change the mobile viewport dimensions without researching common CMP breakpoints (375px is the standard iPhone width used by all major CMPs)
- ALWAYS restore the original viewport after mobile retry
- DO NOT make banner detection a hard requirement — if detection fails, the "BANNER_NOT_DETECTED" finding is the output, not an error

## Final Validation Checklist

- [ ] `waitForBannerVisible()` returns a structured status object
- [ ] Mobile viewport retry executes when desktop detection fails
- [ ] Original viewport is restored after mobile retry
- [ ] `BANNER_NOT_DETECTED` finding appears in report when no banner renders
- [ ] `BANNER_MOBILE_ONLY` finding appears when banner renders only on mobile
- [ ] `banner_detection_json` column exists in `scan_results`
- [ ] `compliance-score-calculator.js` handles `bannerDetected: false`
- [ ] type_i check is enabled and functional
- [ ] All existing violation checks (type_a, b, c, d, e, h, k) still work correctly
- [ ] Old audits (with null `banner_detection_json`) still render reports

---

# Execution Order Summary

The recommended execution order across all issues:

```
Phase A — Banner Fixes (Issue 5)
  Commit 17: Refactor waitForBannerVisible() return type
  Commit 18: Add mobile viewport retry
  Commit 19: Gate noyb checks on banner detection
  Commit 20: Store banner detection in scan_results
  Commit 21: Update compliance scoring for BANNER_NOT_DETECTED
  Commit 22: Enable type_i check

Phase B — Scanner Decomposition (Issue 1)
  Commit 1: Define step context and runner
  Commit 2: Extract browser setup steps
  Commit 3: Extract analysis steps
  Commit 4: Extract finalize steps
  Commit 5a: Map saveScanResults() to context object (SAFE PREP)
  Commit 5b: Make updateProgress() runner-compatible (SAFE PREP)
  Commit 5c: Wire step-runner into scanWebsite() (CONTROLLED CUTOVER)
  Commit 5d: Verify data integrity pre/post refactor
  Commit 6: Clean up dead code

Phase C — Parallelization (Issue 4)
  Commit 15: Extend step-runner for parallel groups
  Commit 16: Group independent steps into parallel batch

Phase D — Test Coverage (Issue 2)
  Commit 7: Test infrastructure + read-first fixture generation
  Commit 8: Tests for detection-confidence.js (read source → document → test)
  Commit 9: Tests for confirmed-tracking-filter.js (read source → document → test)
  Commit 10: Tests for compliance-score-calculator.js (read source → document → test)

Phase E — Legacy Report Removal (Issue 3)
  Commit 11: Audit data parity
  Commit 12: Redirect legacy route
  Commit 13: Delete legacy files
  Commit 14: Remove Handlebars dependency
```

**Total: 25 commits across 5 phases.**
**Estimated total effort: 28–38 hours via Claude Code.**

---

# Global Safety Constraints

These apply to ALL commits across ALL issues:

1. **Never break the API contract** — `POST /api/audit/start`, `GET /api/audit/:id/status`, `GET /api/audit/:id/report-v2` must work after every commit
2. **Never change the SQLite schema destructively** — only ADD columns (ALTER TABLE ADD COLUMN), never DROP or RENAME
3. **Never introduce new npm dependencies** except for the test runner (which is built into Node.js)
4. **Never modify confirmed-tracking-filter.js logic** — it is the SSOT and its behavior must not change (only its callers change)
5. **Never modify the frontend React report components** — only the backend data they consume
6. **Always use structured logging** via `createLogger(module)` for new code
7. **Preserve the fire-and-forget scan pattern** in `audit.routes.js`
8. **Every commit must be independently deployable** — the system runs correctly after any commit in the sequence
