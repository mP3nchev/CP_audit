# CraftPolicy GDPR Auditor — Technical Architecture & Sustainability Report (v2)

**Report Date:** 2026-03-16
**Repository:** mP3nchev/CP_audit
**Codebase Baseline:** origin/main through PR #108 ("diag: add diagnostic logging to all 8 NOYB violation checks")
**Analyst Note:** This report supersedes v1 (March 2026). Significant structural refactoring occurred in PRs #95–#108. All prior architectural descriptions are obsolete.

---

## STEP 1 — System Overview

### Platform Purpose

CraftPolicy GDPR Auditor is a SaaS-grade automated compliance assessment tool that scans websites for GDPR and ePrivacy Directive violations. It produces structured audit reports used by privacy lawyers, DPOs, and compliance consultancies. The platform instruments a live website via headless Chromium, runs multi-layer analysis across eight functional dimensions (cookie detection, network tracking, banner compliance, consent mode, policy text analysis, risk quantification, timeline reconstruction, and vendor identification), and generates a shareable React-rendered PDF report with GDPR legal references.

### Target Users

Privacy lawyers, Data Protection Officers, compliance consultancies, marketing teams managing cookie consent obligations in EU/EEA jurisdictions.

### Main Business Logic

1. User submits a URL → a new audit record is created and a 17-step scan pipeline fires asynchronously.
2. A stealth-hardened headless Chromium session loads the target site, intercepts all network I/O, captures storage writes, and runs all analysis modules.
3. Each step writes its output into a shared scan context object.
4. Results are persisted to SQLite, then assembled into a React-rendered HTML/PDF report uploaded to Vercel Blob.
5. A separate, manual flow handles optional privacy policy document analysis via the Claude AI API.

### Technology Stack

| Layer | Technology | Version/Notes |
|---|---|---|
| Backend runtime | Node.js 18+ / Express 4.18 | Single process, monolithic |
| Headless browser | Puppeteer 23.x + puppeteer-extra + stealth plugin | Covers 15+ bot detection vectors |
| Database | SQLite via better-sqlite3 9.x | WAL mode, single file |
| AI analysis | Anthropic Claude API | Via `claude-api.js`, budget-gated |
| File storage | Vercel Blob (@vercel/blob 0.15) | Screenshots, HTML reports |
| Frontend | Next.js 15 / React 18 | App Router, `.jsx` + `.tsx` mix |
| UI components | shadcn/ui (Radix UI) + Tailwind CSS | ~40 primitive components |
| Backend hosting | Railway (nixpacks container) | Environment: RAILWAY_ENVIRONMENT |
| Frontend hosting | Vercel | vercel.json proxy rewrite |
| Report rendering | Headless Chromium (react-report-renderer.js) | Puppeteer → page.pdf() |
| Test runner | Node.js built-in `node --test` | Added in PR #98 |

---

## STEP 2 — Architecture & Structure

### Project Structure

```
CP_audit/
├── backend/
│   ├── src/
│   │   ├── analyzers/        15 analysis modules (domain-separated)
│   │   ├── config/           Constants, error-codes, JSON registries (noyb, vendors, tracking)
│   │   ├── database/         SQLite init, schema.sql, 3 migration scripts
│   │   ├── generators/       react-report-renderer.js + report-data-adapter.js
│   │   │                     [html-report-builder.js DELETED in PR #99 — only on local disk artifact]
│   │   ├── integrations/     blob-storage.js, claude-api.js
│   │   ├── middleware/        auth.js, error-handler.js, file-upload.js, requestId.js
│   │   ├── routes/            audit.routes.js, health.routes.js
│   │   ├── scanners/
│   │   │   ├── scan-context.js        Shared context object factory (new)
│   │   │   ├── step-runner.js         Step execution engine with parallel support (new)
│   │   │   ├── scan-phase-browser.js  Steps 1–6.6 (new)
│   │   │   ├── scan-phase-analysis.js Steps 7–13.7 with parallel batch (new)
│   │   │   ├── scan-phase-finalize.js Steps 14–17 (new)
│   │   │   ├── website-scanner.js     Thin orchestrator (was 980 lines, now ~270)
│   │   │   └── [other scanners: cookie-extractor, network-monitor, ...]
│   │   └── utils/             logger.js, circuit-breaker.js, violation-debug-logger.js (new)
│   └── test/
│       ├── compliance-score-calculator.test.js
│       ├── confirmed-tracking-filter.test.js
│       └── detection-confidence.test.js
└── frontend/
    ├── app/                   Next.js App Router pages + server-side API proxy
    ├── components/report/     14 React report section components
    └── types/                 TypeScript definitions
```

### Backend Architecture

**Refactored monolith with step-runner pattern.** The most significant structural change since the v1 report is the decomposition of the monolithic `website-scanner.js` (originally ~980 lines) into:

- `scan-context.js` — a typed factory that creates the shared mutable state object (20 fields, typed with comments). Every step reads from and writes to this single object. No return-value merging.
- `step-runner.js` — a generic execution engine that iterates step arrays, catches per-step errors (non-critical steps do not abort), supports `parallel: true` groups via `Promise.allSettled()`, and calls a progress callback after each step.
- `scan-phase-browser.js` (Steps 1–6.6), `scan-phase-analysis.js` (Steps 7–13.7), `scan-phase-finalize.js` (Steps 14–17) — domain-separated phase modules. Each exports an ordered step array.
- `website-scanner.js` is now a thin wrapper: creates context, concatenates the three phase arrays, runs them through `runSteps()`, and handles the pause/resume branch.

### Frontend Architecture

Next.js 15 App Router. `/app/api/proxy/route.js` is a full server-side proxy that forwards requests to the backend API, keeping the API key out of the browser. Report data is fetched server-side and rendered through 14 React components. The React report page (`/report-v2/[id]`) is then re-captured via headless Chromium from the backend for PDF generation — creating a two-process Puppeteer round-trip: one for scanning, one for rendering.

### Database Structure (SQLite)

Seven tables: `audits`, `scan_results`, `policy_analysis`, `cookie_comparisons`, `risk_assessments`, `budget_tracking`, `gdpr_precedents`. Three additive migrations (PRAGMA-guarded ALTER TABLE) run at startup. A fourth migration (`migrate-add-banner-detection.js`) adds `banner_detection_json` to `scan_results` — added in PR #96. All complex analysis outputs are stored as JSON blobs per column (no sub-table normalization).

### API Layer (REST)

Key protected endpoints (require `x-api-key`): `POST /api/audit/start`, `POST /api/audit/:id/privacy-policy`, `POST /api/audit/:id/resume`. Public endpoints (no auth): `GET /api/audit/:id/status`, `GET /api/audit/:id/results`, `GET /api/audit/:id/report`, `GET /api/audit/:id/report-v2`, `GET /api/audit/:id/share`. The legacy `GET /api/audit/:id/report` endpoint was updated in PR #99 (Commit 12) to redirect to the React v2 path — effectively deprecating the Handlebars pipeline via routing, while the file was deleted in the same PR.

### Logical Architecture (Text Diagram)

```
Browser Client
   ↓ (POST /api/audit/start via Next.js proxy)
audit.routes.js
   → Create audit record (SQLite)
   → scanWebsite() [async, fire-and-forget]
       → createScanContext()
       → runSteps([browserSteps, analysisSteps, finalizeSteps])
           ┌── scan-phase-browser.js (Steps 1–6.6) ──────────────────────────┐
           │   launchBrowser → createPage → injectMonitoring → navigate      │
           │   → cookieBaseline → intermediateSnapshot → stabilityWait       │
           │   → consentModeWait → bannerAppearTime                          │
           └─────────────────────────────────────────────────────────────────┘
           ┌── scan-phase-analysis.js (Steps 7–13.7) ────────────────────────┐
           │   [sequential] networkStats (Step 8)                            │
           │   [sequential] bannerCompliance (Step 10)  ← incognito context │
           │   [parallel] { cookieExtraction(7), clientTracking(9),          │
           │                consentModeDetection(10.5), pageMetadata(13) }   │
           │   [sequential] consentMonitor(10.4) → consentModeValidation     │
           │   → timelineConstruction → networkCategorization → correlation  │
           └─────────────────────────────────────────────────────────────────┘
           ┌── scan-phase-finalize.js (Steps 14–17) ─────────────────────────┐
           │   persistScanResults(SQLite) → closeBrowser                     │
           │   → consentSimulation (SKIPPED on Railway) → complianceScore   │
           └─────────────────────────────────────────────────────────────────┘
   → react-report-renderer.js
       → Puppeteer browser 2 → navigate to /report-v2/:id
       → page.pdf() → Vercel Blob upload → shareable URL
```

---

## STEP 3 — Functional Decomposition

---

### 3.1 — Audit Initiation & Budget Gate

**Functional Description:** Creates the audit database record, enforces daily API cost limits, fires the scan asynchronously.

**Trigger Flow:** `POST /api/audit/start` with `{ website_url, client_name, industry }`.

**Execution Logic (`audit.routes.js:25–110`):**
- URL validated with `new URL()` (throws on malformed input).
- `checkBudget()` from `claude-api.js` reads the `budget_tracking` table for today's date. If `spent_usd ≥ $10.00`, returns HTTP 429 with `retryAfter`.
- `crypto.randomBytes(8).toString('hex')` generates the `aud_<hex>` UID.
- Audit inserted as `status = 'processing'` into `audits` table.
- `scanWebsite(url, auditId, auditUid)` called without `await` — HTTP 200 is returned immediately. Scan result is handled in `.then()` (sets `status = 'completed'`) / `.catch()` (sets `status = 'failed'`).

**Security:** `authMiddleware` (timing-safe `crypto.timingSafeEqual` on `x-api-key` header). URL used only as a Puppeteer navigation target — no shell execution path.

**Risk:** The scan process shares the same Node.js event loop as the HTTP server. A Puppeteer crash (unhandled rejection, OOM) can terminate the entire API server process.

---

### 3.2 — Step-Runner Orchestration (Refactored Architecture)

**Functional Description:** The pipeline execution engine introduced in PR #97. Replaces inline sequential code with a generic, testable step-runner pattern.

**Execution Logic (`step-runner.js`):**
- `runSteps(steps, context, updateProgressFn)` iterates over a flat array of step entries.
- Each entry is either sequential (`{ name, stepNumber, execute, critical }`) or a parallel group (`{ parallel: true, name, steps: [...] }`).
- Sequential step: `await entry.execute(context)` inside try/catch. If `entry.critical === true` and execution throws, `aborted = true` terminates remaining steps. Non-critical failures log a warning and continue.
- Parallel group: `Promise.allSettled(entry.steps.map(step => executeStep(step, context)))`. All parallel steps run to completion regardless of individual failures. A `critical` failure in any parallel step sets `aborted = true` after the group finishes.
- Per-step errors pushed to `context.errors[]` — full pipeline runs even with failures, maximizing partial result collection.
- `updateProgressFn` called before each step with `{ stepNumber, name }` — updates `audits.progress_json` for frontend polling.

**Critical Flag Assignments:**
- `critical: true` — Steps 1 (browser launch), 1.2 (navigate), 14 (persist results), 13.6 (network categorization).
- `critical: false` — All analysis steps, monitoring, banner checks, consent simulation. These can fail without aborting the pipeline.

**Risk:** Parallel batch in Step analysis includes `stepBannerCompliance` running BEFORE the batch (moved to sequential due to viewport mutation). Steps in the parallel batch (`stepFinalCookieExtraction`, `stepClientSideTracking`, `stepConsentModeDetection`, `stepPageMetadata`) all read from the same `context.page` concurrently. Concurrent `page.evaluate()` calls on the same Puppeteer page are generally safe (serialized by Chromium's protocol), but timing issues with async DOM state are theoretically possible.

---

### 3.3 — Scan Phase: Browser Setup (Steps 1–6.6)

**Functional Description:** Launches the headless browser, injects monitoring code, navigates to the target URL, and captures baseline measurements before analysis begins.

**Execution Logic (`scan-phase-browser.js`):**

| Sub-Step | Action | Notes |
|---|---|---|
| 1 | `launchBrowser()` via `puppeteer-extra` + `StealthPlugin` | 15+ fingerprint vectors neutralized; Chromium path auto-detected on Railway via `/nix/store` search |
| 1.1 | Network monitor setup + consent-monitor injection + tracking-detector injection | `page.evaluateOnNewDocument()` injects wrappers BEFORE any page scripts execute |
| 1.2 | `navigateToUrl(page, url)` + `networkMonitor.markPageLoaded()` | CRITICAL step — abort on failure |
| 5.5 | Baseline cookie snapshot (no delay) | Captures cookies present before any async scripts run |
| 5.7 | 5-second wait + intermediate cookie snapshot | Catches async-set cookies like `_ga` which appear after page load |
| 6 | `waitForPageStability(page, 3000)` | Waits for DOM/network to settle |
| 6.5 | `detectBannerAppearTime()` — logs timestamp of first banner appearance | Used by Step 10 for banner scope and Step 7 for `loadedBeforeBanner` flag |
| 6.6 | Poll `window.google_tag_data.ics` for 15 seconds | Required for accurate Consent Mode v2 detection; exits early if found |

**Browser Console Capture:** `page.on('console', ...)` filters and logs consent-related console messages (consent/CookieScript/google_tag/ics keywords) for diagnostic purposes.

---

### 3.4 — Scan Phase: Analysis (Steps 7–13.7, Parallel-Enabled)

**Functional Description:** The main analysis batch — runs the core compliance checks and data enrichment. Parallelized where safe.

**Execution Order:**

1. **[Sequential] Step 8 — Preliminary Network Stats:** `networkMonitor.getTrackingRequests()` — domain-based preliminary count. Logged as "preliminary" explicitly; reassigned at Step 13.6.

2. **[Sequential] Step 10 — Banner Compliance:** Runs BEFORE the parallel batch. Moved to sequential because it mutates the page viewport (mobile retry). Operates on a fresh **incognito browser context** (created from `options.browser` via `createBrowserContext()`). See §3.5 for full detail.

3. **[Parallel Batch] Steps 7, 9, 10.5, 13:**
   - **Step 7 (Final Cookie Extraction):** `extractCookies()` with 3-second delay. THREE-TIER timestamp assignment: cookies seen at baseline → `detectionStage: 'baseline'`, intermediate → `'intermediate'`, final → `'final'`. Each cookie gets `loadedBeforeBanner: true/false`.
   - **Step 9 (Client-Side Tracking):** `extractTrackingData()` + `analyzeTracking()` — queries `window.__trackingDetector` injected at Step 1.1; looks for JS tracker objects (`ga`, `fbq`, `_hjid`, etc.).
   - **Step 10.5 (Consent Mode Detection):** `auditConsentMode()` — reads `window.google_tag_data.ics.entries`, `window.dataLayer`, `window.gtag`. Detects CMP presence via `window.CookieScript`, `window.OneTrust`, `window.Cookiebot`, etc.
   - **Step 13 (Page Metadata):** `getPageMetadata(page)` — title, description, canonical URL.

4. **[Sequential tail] Steps 10.4, 10.6, 13.5, 13.6 (CRITICAL), 13.7:**
   - **Step 10.4:** `extractMonitoringData()` + `analyzeMonitoringData()` + vendor fingerprinting. Reads `window.__consentMonitor` (injected at 1.1). Extracts gtag calls, dataLayer events, storage writes. Vendor fingerprinting runs against `vendor-patterns.json` + `vendor-payload-patterns.json`.
   - **Step 10.6:** `validateExecutionOrder()` — checks if any Google Analytics network requests fired before the first `consent/default` dataLayer command.
   - **Step 13.5:** `buildTimeline()` — constructs event-ordered sequence from cookies, network requests, page load timing, and banner appear time.
   - **Step 13.6 (CRITICAL):** `categorizeRequests()` — 5-layer confidence scoring. **Reassigns** `context.trackingRequests` and `context.trackingBeforeConsentRequests` from preliminary domain-based arrays to re-categorized sets. This is the authoritative replacement of the preliminary count.
   - **Step 13.7:** `correlateNetworkAndStorage()` — 1-second window co-occurrence analysis between Category A tracking requests and storage writes. Produces `evidenceStrength: 'HIGH'` evidence for dual-layer GDPR Art. 5(3) violations.

---

### 3.5 — Cookie Banner Compliance — Refactored (PRs #100–#108)

**Functional Description:** Evaluates the live cookie banner for 8 noyb-defined GDPR consent manipulation patterns. The most heavily revised module since v1 — three major overhauls in PRs #100–#108.

**Key Structural Changes from v1:**

1. **Incognito Context (PR #106):** Banner analysis no longer runs on the main scan page. `analyzeCookieBanner()` receives `options.browser` and calls `createBrowserContext()` (Puppeteer 23.x compatible) to create a fresh incognito context, navigates it to the same URL, and runs all checks there. This prevents CookieScript and other CMPs from auto-dismissing the banner because a prior navigation already set consent cookies. Fallback: if incognito creation fails, legacy cookie-clearing flow on the original page is used.

2. **Multi-Phase Banner Detection (PR #103, #104, #105):** `waitForBannerVisible()` now implements a five-phase detection strategy:
   - **Phase A (Tier 1 CMP selectors):** 26 specific CMP selectors (OneTrust, Cookiebot, CookieScript, iubenda, etc.) searched via `querySelectorDeep()` (shadow DOM piercing).
   - **Phase B (Anchor detection):** Traverses all `position:fixed`/`position:sticky`/`z-index > 10` elements, filters navigation/header elements, requires consent keyword from a 70-term multi-language `CONSENT_TRIGGERS` corpus AND at least one `<button>` element.
   - **Phase C (Fuzzy selectors):** Tier 2 broad patterns (`[id*="cookie"]`, `[role="dialog"]`, etc.) with overlay positioning validation.
   - **Phase D (Same-origin iframes):** `querySelectorAll('iframe')` checked with `contentDocument`.
   - **Phase E (Cross-origin iframes):** `page.frames()` API to access cross-origin CMP frames (TrustArc, Didomi). Checks text content for consent keywords + presence of buttons.
   - **MutationObserver fast-path:** Injected via `page.evaluate()` before polling starts. Fires on DOM mutations, checks Tier 1 selectors. Result checked at top of each poll cycle for early exit.
   - **Mobile viewport retry (PR #104):** If no banner found at desktop, resizes to 375x812, retries, then restores original viewport.

3. **Banner-Gating (PR #96):** If `bannerDetectionStatus.found === false` after all phases, all 8 checks are skipped and the result is `{ finding: 'BANNER_NOT_DETECTED', severity: 'critical' }`. This eliminates false-pass results on sites without banners.

4. **Banner-Scoped Checks (PR #103):** All 7 active violation checks now receive `bannerSelector` (the CSS selector identifying the detected banner container). Checks scope their DOM queries to that container first (`container = document.querySelector(selector)`), falling back to `document` if the container is not found. A `scopedTo: 'document'` warning is logged when the fallback is used.

5. **`type_i` Check Re-enabled (PR #96, Commit 22):** `checkViolation()`'s `case 'type_i':` now calls `checkMisclassifiedEssentialCookies(cookies, violation)` instead of returning a hardcoded skip. The implementation filters cookies in the `necessary/essential` category against `tracking_patterns_forbidden` (`_ga`, `_gid`, `_fbp`, `_hjid`, `doubleclick`, `__gads`).

6. **Diagnostic Logging Layer (PR #108):** `violation-debug-logger.js` added. When `DEBUG_VIOLATIONS=true`:
   - `initDebugSession(auditId)` creates a `/logs/violations/<auditId>_<timestamp>/` directory.
   - Each violation check calls `logViolationCheck()` → writes `<type_x>.json` with full evidence.
   - `saveScreenshot()` saves PNG evidence files.
   - `saveSummary()` writes `_summary.json`.
   - Pre-check banner DOM state diagnostic: logs `banner.inDOM`, `banner.visible`, dimensions, `display/visibility` — fires warning if banner is missing or invisible at check time.
   - Post-check `noyb-rubber-stamp-warning`: logs any checks that passed without finding the banner container (potential false-pass detection).

**Per-Check Summary (Current State — All 8 Active):**

| ID | Name | Live DOM? | Banner-Scoped? | Notes |
|---|---|---|---|---|
| type_a | No Reject Button | Yes | Yes — scoped to `bannerSelector` | Shadow DOM pierce; multi-language keywords; warns if no container |
| type_b | Pre-ticked Boxes | Yes | Yes | Shadow DOM pierce; filters essential labels |
| type_c | Deceptive Link Design | Yes | Yes | Accept BUTTON vs settings A-tag; fontSize ratio < 0.7 |
| type_d | Deceptive Button Colors | Yes | Yes | HSL analysis + hex registry |
| type_e | Deceptive Button Contrast | Yes | Yes | Area, fontWeight, padding ratios |
| type_h | Legitimate Interest | Yes | No (body text scan) | `document.body.innerText` + multi-language |
| type_i | Misclassified Cookies | Cookie array only | N/A | Now active — compares to `tracking_patterns_forbidden` |
| type_k | Consent Withdrawal | Yes | No (footer/nav scan) | Searches persistent withdrawal mechanisms |

**Compliance Percentage Calculation:** `Math.round(passedCount / (totalChecks - skippedCount) * 100)`. With all 8 checks potentially active, denominator is 8 minus runtime-skipped checks. A check is skipped only on runtime error or `BANNER_NOT_DETECTED`.

---

### 3.6 — Network Request Categorization (5-Layer Confidence Scoring)

**Functional Description:** Replaces binary domain-matching with multi-layer probabilistic scoring. Unchanged since v1.

**Execution Logic (`network-request-categorizer.js`, `detection-confidence.js`):**
- 15 known vendors in `TRACKING_VENDORS` registry.
- `analyzeRequest()` computes composite score across 5 layers: L1 protocol signals (tracking pixel, sendBeacon), L2 entropy (identity parameters), L3 behavioral clustering, L4 semantic path signals, L5 fingerprinting parameters.
- Hard overrides: resource loads → always C; consent pings (gcs/gcd URL params) → always C; `responseStatus === 0` or `failed === true` → always C (blocked request = no data transmitted).
- Final categories: A (≥70), B (40–69), C (<40).
- At Step 13.6, `context.trackingRequests` and `context.trackingBeforeConsentRequests` are **replaced** with re-categorized arrays. The preliminary count from Step 8 is discarded.

---

### 3.7 — SSOT Confirmed Tracking Filter (Three-Layer Metric Hierarchy)

**Functional Description:** Single Source of Truth for legally admissible tracking violation counts. Unchanged in logic since v1 (PR #90), but now also used by the React report data adapter.

**Layer Architecture (`confirmed-tracking-filter.js`):**
- **Layer 1 (n1):** All raw network requests.
- **Layer 2 (n2):** Category A + B (confidence ≥40) — "preliminary detection".
- **Layer 3 (n3):** Category A (confidence ≥70) + `beforeConsent: true` + not benign resource/extension (with tracking pixel exception for `.gif` with `search.length > 10` + known tracking path). This is the ONLY count used in executive summaries, compliance determinations, and legal risk assessments.

**Fallback:** If `requestCategorization` is null (pre-migration audit data), falls back to `req.isTracking === true` legacy flag.

---

### 3.8 — Privacy Policy Analysis (Claude AI)

**Functional Description:** Analyzes uploaded privacy policy documents against 37 GDPR criteria using the Anthropic Claude API. Unchanged since v1.

**Trigger Flow:** `POST /api/audit/:id/privacy-policy` with multipart file (PDF, DOCX, TXT).

**Execution Logic:** `file-upload.js` (multer) → `text-extractor.js` (pdf-parse / mammoth / plaintext) → structured prompt to Claude API with 37-criterion evaluation → `criteria_scores_json` stored in `policy_analysis` table. `circuit-breaker.js` wraps the API call. Budget tracking updated after each call.

**Note:** The actual prompt text is not in the repository (the `prompts/` directory contains only a `.gitkeep` and a README). The prompt is assembled inline in `privacy-policy-analyzer.js`.

---

### 3.9 — Compliance Score Calculation

**Functional Description:** Synthesizes all analysis outputs into a single compliance score (0–100) with grade (A–F), component breakdown, and score-capping logic for critical violations.

**Trigger Flow:** Step 17 (via `scan-phase-finalize.js`). Also callable on-demand from the frontend-facing `GET /api/audit/:id/results` endpoint.

**Execution Logic (`compliance-score-calculator.js`):**
- Five scored components: Cookie Banner (35%), Privacy Policy (30%), Consent Mode (15%), Technical Implementation (15%), Cookie Policy (5%).
- Score caps: `BANNER_NOT_DETECTED` → caps total at 25. Multiple critical violations → further cap. Tracking before consent → modifier applied.
- `calculateOverallScore()` also accepts `bannerDetectionStatus` to handle the `BANNER_NOT_DETECTED` case introduced in PR #96.

---

### 3.10 — Report Generation (React Pipeline Only)

**Functional Description:** As of PR #99 (Commit 13), the Handlebars HTML report builder is deleted from the repository. The React pipeline is the sole report generation path.

**Route state (current):** `GET /api/audit/:id/report` was updated in Commit 12 to redirect to `/report-v2/:id`. The `html-report-builder.js` file exists on local disk as a checkout artifact but is NOT in `origin/main` (`git show origin/main:backend/src/generators/html-report-builder.js` → `fatal: path … not in 'origin/main'`). The route references only `renderReactReportToHTML` from `react-report-renderer.js`.

**Execution Logic (`react-report-renderer.js`):**
1. Launches a second headless Chromium instance (separate from the scan browser).
2. Navigates to `${FRONTEND_BASE_URL}/report-v2/${auditUid}` — this hits the Next.js frontend which fetches audit data from the backend API and renders 14 React components.
3. Waits for `networkidle0`.
4. `page.pdf()` at 1200px viewport with `deviceScaleFactor: 2`.
5. PDF buffer uploaded to Vercel Blob → returns shareable URL.

**Report Data Flow (`report-data-adapter.js`):** Reads all tables for an audit, parses JSON blobs, calls `buildMetricHierarchy()` (SSOT), and assembles the props passed to each React report component.

---

## STEP 4 — Cross-System Logic

### Shared Services

| Service | Location | Role |
|---|---|---|
| `createLogger(module)` | `utils/logger.js` | Structured JSON stdout logging across all 50+ modules |
| `getDatabase()` | `database/db.js` | Singleton SQLite connection; WAL mode; all reads/writes pass through this |
| `createScanContext()` | `scanners/scan-context.js` | Factory for the single shared state object; no global state needed |
| `runSteps()` | `scanners/step-runner.js` | Pipeline execution engine; decoupled from domain logic |
| `requestIdMiddleware` | `middleware/requestId.js` | UUID attached to every HTTP request for log correlation |
| `circuit-breaker.js` | `utils/circuit-breaker.js` | Wraps external Claude API calls; opens on repeated failure |
| `checkBudget()` | `integrations/claude-api.js` | Daily API spend gate; reads/writes `budget_tracking` table |
| `buildMetricHierarchy()` | `analyzers/confirmed-tracking-filter.js` | SSOT for tracking violation counts; used by report adapter |
| `violation-debug-logger.js` | `utils/violation-debug-logger.js` | File-system debug log writer; active only when `DEBUG_VIOLATIONS=true` |

### Central Orchestration

`website-scanner.js:scanWebsite()` remains the central orchestration entry point but is now a thin wrapper (~270 lines). It delegates all domain logic to three phase modules via `step-runner.js`. The shared context object (`scan-context.js`) is the sole data bus between steps — no event emitters, no message queues.

### Module Interaction Map

```
audit.routes.js
  → website-scanner.js: scanWebsite()
      → scan-context.js: createScanContext()
      → step-runner.js: runSteps([browserSteps, analysisSteps, finalizeSteps], context, progressFn)
          scan-phase-browser.js → puppeteer-setup.js, cookie-extractor.js,
                                   network-monitor.js, tracking-detector.js,
                                   consent-monitor.js, timeline-builder.js
          scan-phase-analysis.js → [parallel] cookie-extractor.js, tracking-detector.js,
                                             consent-mode-detector.js, puppeteer-setup.js
                                  [sequential] cookie-banner-checker.js → noyb-violations.json
                                                                        → violation-debug-logger.js (DEBUG)
                                               consent-monitor.js, vendor-fingerprinter.js,
                                               consent-mode-validator.js, timeline-builder.js,
                                               network-request-categorizer.js → detection-confidence.js
                                               [correlateNetworkAndStorage inline]
          scan-phase-finalize.js → website-scanner.js:saveScanResults() → SQLite
                                   puppeteer-setup.js:closeBrowser()
                                   consent-simulator-v1.js (SKIPPED on Railway)
                                   compliance-score-calculator.js
  → react-report-renderer.js → puppeteer (browser 2) → Next.js /report-v2/:id
                              → report-data-adapter.js → confirmed-tracking-filter.js (SSOT)
                              → blob-storage.js → Vercel Blob
```

---

## STEP 5 — Technical Sustainability Indicators

| Indicator | Status (v2) | Change from v1 | Evidence |
|---|---|---|---|
| Code modularity | **Good** | Significantly improved | `website-scanner.js` ~270 lines vs 980. 5 new single-concern modules. |
| Separation of concerns | **Good** | Improved | Phase files own their steps. Context object is explicit data bus. |
| Maintainability | **Medium** | Improved | TypeScript still absent from backend. Naming is consistent. |
| Test coverage | **Partial** | New in PR #98 | 3 test files (640 lines) using Node.js built-in runner. Covers SSOT filter, detection confidence, compliance score. NO tests for banner checker, scanner phases, routes, or report rendering. |
| Dependency management | **Adequate** | Unchanged | Handlebars removed from `package.json` (PR #99). puppeteer-extra/stealth added. |
| Scalability readiness | **Low** | Unchanged | SQLite + single process + blocking Puppeteer per audit. Parallel batch in analysis phase is an intra-audit optimization, not horizontal scale. |
| Observability/logging | **Good** | Improved | `violation-debug-logger.js` adds per-audit file-based debug trails. `noyb-rubber-stamp-warning` alerts on likely false-pass scenarios. Request correlation via `requestId`. Railway log upload verified by `logs.*.json` in repo root. |
| CI/CD | **None detected** | Unchanged | No `.github/workflows/`. No Dockerfile in repo. nixpacks.toml is Railway-specific. |
| Screenshots | **Disabled** | Unchanged | `context.screenshotUrls` initialized to `{}`. Steps 11–12 reference only stub behavior. |
| Parallel analysis | **New** | Added PR #97 | `Promise.allSettled` on 4 independent analysis steps. Reduces analysis phase wall time. |
| Banner false-positive prevention | **Improved** | Significant | Navigation/header exclusion filters, keyword corpus requirement, overlay position validation, MutationObserver fast-path, mobile retry. |
| Report pipeline | **Simplified** | Improved | Single report path (React). Legacy Handlebars deleted. |

---

## STEP 6 — Final Structured Summary

### High-Level Architecture Summary

CraftPolicy GDPR Auditor is a monolithic Node.js application on Railway, architecturally refactored (PRs #95–#99) from a single 980-line orchestrator function into a step-runner pattern with three domain-separated phase modules and a shared immutable context object. The scan pipeline supports mixed sequential/parallel step execution. The frontend is a stateless Next.js proxy on Vercel. SQLite provides all persistence. The Claude API and Vercel Blob are the only external service dependencies. The report generation creates a second Puppeteer browser instance to render the React report to PDF. There are zero CI/CD pipelines; deployment is directly via Railway (backend) and Vercel (frontend).

### Key Strengths

- **Step-runner architecture:** Clean, testable step abstraction. Each step is individually debuggable, independently critical-flagged, and can be parallelized without modifying orchestration logic.
- **Shared context pattern:** Eliminates return-value merging between steps. Explicit contract defined in `scan-context.js`.
- **Incognito context for banner detection:** Prevents CMP auto-dismiss race condition. Architecturally correct for CMP testing scenarios.
- **Multi-phase banner detection:** Five-phase strategy with MutationObserver, cross-origin iframe support, mobile viewport retry, and navigation element exclusion significantly reduces false negatives and false positives.
- **SSOT metric hierarchy:** Three-layer counting with explicit GDPR legal basis. Used consistently across both report pipelines.
- **Diagnostic debug layer:** `violation-debug-logger.js` + rubber-stamp warning system provides actionable per-audit evidence for check reliability assessment.
- **Test coverage introduced:** First automated tests in the codebase; 640-line coverage for the three most legally critical modules.
- **Single report pipeline:** Handlebars legacy path removed. Single source of truth for report output.

### Critical Technical Debt

1. **No tests for the scan pipeline itself.** `scan-phase-browser.js`, `scan-phase-analysis.js`, `scan-phase-finalize.js`, `cookie-banner-checker.js`, `audit.routes.js`, and `react-report-renderer.js` have zero automated test coverage. The core product functionality is untested.

2. **Puppeteer in application process.** Both the scan browser and the report-rendering browser run in the same Node.js process as the HTTP server. A Puppeteer crash or OOM event kills the API server.

3. **SQLite hard limit on concurrency.** Each concurrent audit runs one Puppeteer instance. Two simultaneous scans open two browser processes, both writing to the same SQLite file. At moderate concurrency this will exhaust Railway's memory limit and produce SQLite `SQLITE_BUSY` errors.

4. **Consent simulation permanently bypassed.** `SKIP_CONSENT_CHECK=true` is set in the Railway environment. Step 16 (`consent-simulator-v1.js`) never executes in production. The pause/resume mechanism is dead code in the production deployment.

5. **`html-report-builder.js` exists on local disk but not in origin/main.** The file is present in the working directory as a checkout artifact from a pre-deletion branch. Any developer pulling a fresh clone will not have this file, but it can cause confusion in the working repository. Import paths that reference it locally will fail on clean installs.

6. **`violation-debug-logger.js` writes to the local filesystem.** `/logs/violations/` is relative to the backend directory. On Railway (ephemeral container), these logs are lost on container restart. There is no log aggregation or upload path for debug sessions. The debug mode is only useful locally.

7. **No TypeScript in the backend.** The 50+ module backend is fully JavaScript. `scan-context.js` uses JSDoc-style comments for type documentation, but there is no compile-time type safety.

### Sustainability Risk Indicators

- **Memory pressure under load:** Each Puppeteer browser instance requires ~150–300MB. A Railway instance running two concurrent audits and one concurrent report render could use 900MB+.
- **Migration fragility:** Three startup migrations (`migrate-add-scoring`, `migrate-add-monitoring`, `migrate-add-banner-detection`) all use PRAGMA guards. Adding a fourth migration requires manual care to avoid incorrect guard logic. No migration framework (e.g., Knex, Flyway) is used.
- **Budget enforcement single-node only:** `checkBudget()` reads from SQLite, making it correct for single-instance. Railway auto-scaling (if enabled) would break the per-day budget accumulation.
- **Cross-origin iframe detection is best-effort:** Phase E of banner detection calls `frame.evaluate()` which can fail silently on cross-origin frames. Failed frames log as expected and are skipped — but this means CMP banners hosted in cross-origin iframes (TrustArc, Didomi) may be missed.
- **Parallel batch timing risk:** `stepFinalCookieExtraction`, `stepClientSideTracking`, `stepConsentModeDetection`, and `stepPageMetadata` all run concurrently on the same Puppeteer page. If any step triggers page navigation or an `alert()` dialog, other parallel steps may fail in non-obvious ways.

### Areas Requiring Deeper Audit

1. **Banner check reliability with real CMPs:** The `noyb-rubber-stamp-warning` log event indicates that checks are passing without finding the banner container. This requires testing against actual CMP implementations (OneTrust, Cookiebot, CookieScript) to validate that `bannerSelector` propagation from `waitForBannerVisible()` into each check function is correct end-to-end.

2. **`type_i` check accuracy:** Now active, but relies on the `cookies` array passed from the scan context. This array represents the full cookie list from the main scan page — not cookies from the incognito banner analysis page. There is potential for misattribution if the incognito session produces a different cookie set.

3. **Privacy policy prompt design:** The 37-criterion Claude API prompt is assembled inline in `privacy-policy-analyzer.js` but not visible without reading that file. Its evaluation criteria, scoring thresholds, and legal basis mapping require independent review.

4. **`vendor-patterns.json` and `tracking-domains.json` provenance:** The registry files that underpin 5-layer categorization and domain-based preliminary tracking detection have no documented update cadence, source, or version. False negative/positive rates are directly tied to their accuracy.

5. **Report-rendering Puppeteer second process:** `react-report-renderer.js` launches a plain `puppeteer` import (not `puppeteer-extra`). The report rendering browser is not stealth-hardened. If the frontend (`FRONTEND_BASE_URL`) requires any authenticated headers or rate-limits the renderer's IP, report generation will silently fail or produce empty PDFs.

6. **Railway log upload flow:** The `logs.*.json` files in the repository root represent raw Railway deployment logs uploaded manually to the repository (GitHub web UI "Add files via upload"). This is a manual operational practice with no automation. The logs contain runtime scan telemetry but are committed to the repository root — a non-standard and potentially leaky practice for audit data.

---

*End of Report — v2*
