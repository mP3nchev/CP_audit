# CraftPolicy GDPR Auditor — Technical Architecture & Sustainability Report

**Report Date:** 2026-03-09
**Repository:** mP3nchev/CP_audit
**Analyst Scope:** Full codebase + PRs #88 through #94
**Report Purpose:** Architectural sustainability review input for Claude Opus 4.6 evaluation

---

## STEP 1 — System Overview

### Platform Purpose

CraftPolicy GDPR Auditor is an automated SaaS compliance assessment tool that scans websites for GDPR and ePrivacy Directive violations. It is designed to replace manual legal audits for cookie consent compliance, producing court-admissible-style PDF/HTML reports for law firms, consultancies, and DPO functions.

### Target Users

Privacy lawyers, Data Protection Officers, compliance consultants, and marketing agencies responsible for GDPR cookie consent on client websites.

### Main Business Logic

1. A user submits a URL via a frontend form.
2. A headless Chromium browser (Puppeteer) loads the target site and intercepts all network requests, cookies, and storage writes.
3. Multiple analyzers run in sequence: cookie banner compliance (noyb checklist), consent mode detection, network tracking categorization, and privacy policy analysis (via Claude AI API).
4. Results are scored, assembled into a structured report, and stored. A shareable HTML/PDF report is generated and hosted on Vercel Blob.

### Technology Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 18+ / Express 4.18 |
| Headless browser | Puppeteer 23.x (Chromium) |
| Database | SQLite via better-sqlite3 9.x |
| AI analysis | Anthropic Claude API (claude-api.js) |
| File storage | Vercel Blob (@vercel/blob 0.15) |
| Frontend framework | Next.js 15 / React 18 |
| UI library | shadcn/ui (Radix UI primitives) + Tailwind CSS |
| Backend hosting | Railway (nixpacks deployment) |
| Frontend hosting | Vercel |
| Report rendering | Headless Chromium (React SSR → HTML → PDF via react-report-renderer.js) |
| Legacy report | Handlebars templates (gdpr-report-template.html) — deprecated in PR #92 |

---

## STEP 2 — Architecture & Structure

### Project Structure

```
CP_audit/
├── backend/
│   └── src/
│       ├── analyzers/       # 14 analysis modules (per-concern)
│       ├── config/          # Constants, error codes, JSON registries
│       ├── database/        # SQLite init, schema, migrations
│       ├── generators/      # Report builders (HTML, React-render, data adapter)
│       ├── integrations/    # Vercel Blob, Claude API
│       ├── middleware/      # Auth, error handler, file upload, requestId
│       ├── routes/          # audit.routes.js, health.routes.js
│       ├── scanners/        # Puppeteer orchestration + sub-scanners
│       └── utils/           # Logger, circuit breaker, retry handler, schema validator
├── frontend/
│   ├── app/                 # Next.js App Router pages + API proxy routes
│   ├── components/
│   │   ├── report/          # 14 React report section components
│   │   └── ui/              # 40+ shadcn/ui primitive components
│   └── types/               # TypeScript type definitions
└── [docs]                   # TASK.md, TECHNICAL_SPECS.md, deployment guides
```

### Backend Architecture

**Monolithic Express application** with domain-separation through modules. No microservices. No message queue. The scan pipeline runs asynchronously in-process after the HTTP response is sent (fire-and-forget pattern via `.then()/.catch()`).

**State machine within a single async function:** `scanWebsite()` in `website-scanner.js` contains 17 explicitly numbered steps tracked via `updateProgress()` writing JSON to the `audits.progress_json` column. The frontend polls `GET /api/audit/:id/status` to observe state.

### Frontend Architecture

Next.js 15 App Router with a mix of `.jsx` (pages) and `.tsx` (report components). A server-side API proxy (`/app/api/proxy/route.js`) forwards all backend calls, avoiding CORS issues and exposing the backend API key only server-side. Report data is fetched server-side then rendered as a React component tree which is then re-captured via headless Chromium (React → HTML string → PDF).

### Database Structure

SQLite with 7 tables:

| Table | Purpose |
|---|---|
| `audits` | Master record per audit; holds progress_json state machine |
| `scan_results` | All scanner outputs (JSON blobs per column) |
| `policy_analysis` | Claude AI analysis of privacy/cookie policies |
| `cookie_comparisons` | Declared vs actual cookie comparison |
| `risk_assessments` | GDPR fine range, precedents |
| `gdpr_precedents` | Populated from CSV; queried for risk calculations |
| `budget_tracking` | Per-day Claude API spend persistence |

Migrations are applied at startup via `migrate-add-scoring.js` and `migrate-add-monitoring.js` (ALTER TABLE guarded by PRAGMA column checks).

### API Layer

REST. All endpoints under `/api/*`. Public endpoints (report viewing, sharing) exempted from `authMiddleware`. Protected endpoints require `x-api-key` header (timing-safe comparison via `crypto.timingSafeEqual`).

Key routes: `POST /api/audit/start`, `GET /api/audit/:id/status`, `GET /api/audit/:id/results`, `GET /api/audit/:id/report`, `GET /api/audit/:id/report-v2`, `GET /api/audit/:id/share`, `POST /api/audit/:id/privacy-policy`, `POST /api/audit/:id/resume`.

### Third-Party Integrations

- **Anthropic Claude API** — privacy policy text analysis (37-criterion GDPR scoring)
- **Vercel Blob** — screenshot and report HTML storage
- **Puppeteer** — headless Chromium automation (scanning + PDF rendering)

---

## STEP 3 — Functional Decomposition

---

### 3.1 — Audit Initiation

**Functional Description:** Creates an audit record, validates the URL, checks Claude API budget, and fires the scan pipeline asynchronously.

**Trigger Flow:** `POST /api/audit/start` with `{ website_url, client_name, industry }`.

**Execution Logic:**
- `audit.routes.js:26` — validates URL format via `new URL()`.
- `claude-api.js:checkBudget()` — checks `budget_tracking` table for today's spend against the $10/day cap. Returns HTTP 429 if exceeded.
- `crypto.randomBytes(8)` generates `aud_<hex>` UID inserted into `audits` table.
- `scanWebsite(url, auditId, auditUid)` called without `await` — scan runs after HTTP 200 is returned.
- On scan completion, the `.then()` handler sets `status = 'completed'`; on failure, `.catch()` sets `status = 'failed'`.

**Security:** `authMiddleware` (x-api-key header) guards this endpoint. URL is only used for Puppeteer navigation — no shell execution.

**Risk:** Scan runs in the same Node.js process as the Express server. A crash in Puppeteer during a scan could take down the API server.

---

### 3.2 — Website Scanning Pipeline (17-Step Orchestrator)

**Functional Description:** `scanWebsite()` in `website-scanner.js` is the central pipeline. It coordinates all scanner modules, enriches results through multiple analysis passes, and writes the final dataset to the database.

**Trigger Flow:** Called asynchronously from `audit.routes.js` after audit creation.

**Step-by-Step Execution Logic:**

| Step | Action | File |
|---|---|---|
| 1 | Browser launch, page creation, monitoring injection, navigation | `puppeteer-setup.js`, `network-monitor.js`, `consent-monitor.js` |
| 5.5 | Immediate cookie snapshot (no delay) | `cookie-extractor.js` |
| 5.7 | 5-second wait + intermediate snapshot (catches async cookies like `_ga`) | `cookie-extractor.js` |
| 6 | Page stability wait (3s) | `puppeteer-setup.js` |
| 6.6 | Poll for `window.google_tag_data.ics` (15s max, 500ms intervals) | inline in `website-scanner.js` |
| 6.5 | Detect banner appear time | `timeline-builder.js:detectBannerAppearTime()` |
| 7 | Final cookie extraction with 3s delay; three-tier timestamp assignment | `cookie-extractor.js` |
| 8 | Preliminary network stats from network-monitor (domain-based, pre-categorization) | `network-monitor.js` |
| 9 | Client-side tracking data extraction (localStorage, indexedDB, JS trackers) | `tracking-detector.js` |
| 10 | noyb 8-point cookie banner checklist | `cookie-banner-checker.js` |
| 10.4 | Consent monitoring data extraction + vendor fingerprinting | `consent-monitor.js`, `vendor-fingerprinter.js` |
| 10.5 | Google Consent Mode v2 detection and validation | `consent-mode-detector.js` |
| 10.6 | Consent Mode execution order validation | `consent-mode-validator.js` |
| 11-12 | Screenshots — **HARD DISABLED** (commented out; blocked for performance reasons) | — |
| 13 | Page metadata extraction | `puppeteer-setup.js:getPageMetadata()` |
| 13.5 | Timeline construction | `timeline-builder.js:buildTimeline()` |
| 13.6 | Network request re-categorization (5-layer confidence scoring) | `network-request-categorizer.js` |
| 13.7 | Network-storage correlation (1-second window co-occurrence analysis) | inline `correlateNetworkAndStorage()` in `website-scanner.js` |
| 14 | Database persistence (`saveScanResults()`) | SQLite |
| 15 | Browser close | `puppeteer-setup.js:closeBrowser()` |
| 16 | Human-assisted consent simulation (may PAUSE audit) | `consent-simulator-v1.js` |
| 17 | Compliance score calculation | `compliance-score-calculator.js` |

**Critical implementation detail (Step 13.6):** After re-categorization, the preliminary `trackingRequests` array from Step 8 is **replaced** (`trackingRequests = requestCategorization.trackingRequests`). The filter `r => r.beforeConsent` is applied on the re-categorized set. This is the source of the 22 vs 18 vs 5 discrepancy (see §5 below).

**Data Interaction:** All results stored in `scan_results` table as JSON blobs per column. Single-row write at Step 14.

**Risk:** 17 steps in one function (~980 lines). No partial commit strategy — if Step 17 fails, partial data from Step 14 is already written but score is missing. Browser is closed at Step 15, before Steps 16–17 complete.

---

### 3.3 — Network Request Categorization (5-Layer Confidence Scoring)

**Functional Description:** Replaces the binary domain-matching of the preliminary network-monitor with a multi-layer probabilistic scoring system that assigns every request to Category A (confirmed tracking, confidence ≥70), B (suspicious, 40–69), or C (benign, <40).

**Trigger Flow:** Called at Step 13.6 of the scan pipeline.

**Execution Logic (`network-request-categorizer.js`):**
1. URL is parsed; vendor is matched against `TRACKING_VENDORS` registry (15 vendors: Google, Facebook, Microsoft, LinkedIn, TikTok, Snapchat, Pinterest, Reddit, HubSpot, Adobe, Hotjar, Yandex, YouTube, Vimeo, Marketo).
2. A domain match alone is NOT sufficient. The request is enriched with `isResource` (script/CSS loads) and `isKnownTrackingPath` flags.
3. `analyzeRequest()` from `detection-confidence.js` runs 5 scoring layers: L1 protocol signals (pixel, sendBeacon), L2 entropy (identity parameters in payload), L3 behavioral clustering, L4 semantic signals (path patterns), L5 fingerprinting parameters.
4. Hard overrides: resource loads → always C; consent pings (gcs/gcd params) → always C; `responseStatus === 0` or `failed === true` → always C (blocked/failed, no data transmission).
5. Final category mapped from composite confidence score.

**Data Interaction:** Reads raw requests from `networkMonitor.getRequests()`. Produces `requestCategorization` object (categoryA, categoryB, categoryC arrays + vendor breakdown). Stored as `request_categorization_json` in `scan_results`.

---

### 3.4 — SSOT Confirmed Tracking Filter (Three-Layer Metric Hierarchy)

**Functional Description:** Introduced in PR #90 (`confirmed-tracking-filter.js`). Establishes a Single Source of Truth for the legally-relevant tracking violation count used in all report surfaces, resolving the numerical inconsistency described in §5.1.

**Trigger Flow:** Called by `html-report-builder.js:buildMetricHierarchy()` at report generation time (not during scan).

**Layer Definitions (`confirmed-tracking-filter.js:buildMetricHierarchy()`):**
- **Layer 1 (n1):** All raw network requests captured — observational evidence only.
- **Layer 2 (n2):** Category A + B requests combined — preliminary detection, confidence ≥40.
- **Layer 3 (n3):** The authoritative count — Category A only, confidence ≥70, `beforeConsent === true`, not a benign resource type, not a benign static file extension. Tracking pixel exception: `.gif` and `image` resources ARE included if they have `search.length > 10` AND a known tracking path (e.g., `/tr`, `/collect`, `/pixel`).

**Legal Basis Noted in Code:** GDPR Art. 5(1)(d) accuracy, Art. 5(2) accountability. Only Layer 3 may be used for executive summary counts, compliance determination statements, and legal risk classification.

**Risk:** This filter runs at report-generation time from stored JSON, not from the live scan objects. If `request_categorization_json` is null (pre-migration audits), it falls back to `req.isTracking === true` — the legacy domain-based flag.

---

### 3.5 — Cookie Banner Compliance (noyb 8-Point Checklist)

**Functional Description:** Evaluates the live cookie banner DOM for 8 categories of GDPR consent manipulation defined by noyb's enforcement methodology. Each check runs a `page.evaluate()` call against the actual browser DOM during the scan session.

**Trigger Flow:** Step 10 of the scan pipeline. Called as `analyzeCookieBanner(page, auditId, cookies)` on the **same browser page instance** used throughout the main scan, after navigation and cookie collection.

**Per-Check Implementation (`cookie-banner-checker.js`):**

| ID | Name | Detection Method | Live DOM? |
|---|---|---|---|
| type_a | No Reject Button | Searches main doc + iframes + shadow DOM for accept/reject buttons by CSS attribute and multi-language text keywords | Yes — `page.evaluate()` |
| type_b | Pre-ticked Boxes | `document.querySelectorAll('input[type="checkbox"]:checked')`, filters out essential-labeled checkboxes | Yes — `page.evaluate()` |
| type_c | Deceptive Link Design | Finds accept (BUTTON) vs settings (A tag); compares `fontSize` ratio; violation if ratio < 0.7 | Yes — `page.evaluate()` with `window.getComputedStyle()` |
| type_d | Deceptive Button Colors | Extracts `backgroundColor` for accept vs reject; HSL similarity check (green/blue vs grey/muted) OR exact hex match against hardcoded palette | Yes — `page.evaluate()` |
| type_e | Deceptive Button Contrast | Compares `offsetWidth * offsetHeight`, `fontWeight`, and padding ratio between accept and reject buttons | Yes — `page.evaluate()` |
| type_h | Legitimate Interest for Ads | `document.body.innerText` text search for "legitimate interest" + ad context keywords | Yes — `page.evaluate()` |
| type_i | Misclassified Cookies | **HARDCODED `detected: false, skipped: true`** — function `checkMisclassifiedEssentialCookies()` exists but the `checkViolation()` switch statement returns a hardcoded skip result without calling it | Not executed |
| type_k | Difficult Consent Withdrawal | Searches footer/header/floating elements for consent withdrawal mechanisms by CSS selector + multi-language text | Yes — `page.evaluate()` |

**Banner Visibility Handling:** Before type_a check, `waitForBannerVisible(page, 10000)` polls every 500ms for up to 10 seconds. Detection uses generic selectors: `[id*="cookie"]`, `[class*="consent"]`, `[role="dialog"]`, etc., searching both main document and same-origin iframes. If the banner is not found, a warning is logged but the check **continues** (does not skip) — buttons are still searched globally across the full page DOM regardless of banner visibility state.

**Compliance Percentage Calculation:** `Math.round((passedCount / (totalChecks - skippedCount)) * 100)`. With type_i always skipped, effective denominator is 7 checks.

**Error Handling:** Any exception in a check causes it to return `{ detected: false, skipped: true }` — it does not propagate as a violation.

**Data Interaction:** Results stored as `banner_violations_json` in `scan_results`. Also stored in `bannerAnalysis` object within compliance score calculation.

---

### 3.6 — Consent Mode v2 Detection

**Functional Description:** Validates whether the scanned website correctly implements Google Consent Mode v2 before Google Analytics/Ads tags fire.

**Trigger Flow:** Step 10.5, after banner analysis.

**Execution Logic (`consent-mode-detector.js:detectConsentMode()`):**
- Primary method: reads `window.google_tag_data.ics.entries` (confidence 99.5%) — checks `active`, `usedDefault`, `usedUpdate`, `waitPeriodTimedOut` flags plus presence of all 4 required parameters (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`).
- Secondary: inspects `window.dataLayer` for `['consent', 'default', {...}]` commands.
- Tertiary: checks for `window.gtag` function presence.
- **CMP detection diagnostics** also check for: `window.CookieScript`, `window.OneTrust`, `window.Cookiebot`, `window.getCkyConsent`, `localStorage.getItem('gdprCache')`, `window.UC_UI`.
- Consent Mode initialization is pre-waited at Step 6.6 (polling for `google_tag_data.ics` for up to 15 seconds before proceeding).

**Execution Order Validation (`consent-mode-validator.js`):** After detection, checks whether any Google Analytics network requests fired before the first `consent/default` dataLayer command. If yes, `consentModeAudit.hasExecutionOrderViolation = true`.

---

### 3.7 — Privacy Policy Analysis (Claude AI)

**Functional Description:** Analyzes uploaded privacy policy documents against 37 GDPR criteria using the Anthropic Claude API.

**Trigger Flow:** `POST /api/audit/:id/privacy-policy` with file upload (PDF, DOCX, or TXT). Separate from the main scan pipeline — triggered manually.

**Execution Logic (`privacy-policy-analyzer.js`, `claude-api.js`):**
- `file-upload.js` (multer) accepts the file.
- `text-extractor.js` parses PDF (pdf-parse), DOCX (mammoth), or TXT.
- Text sent to Claude API with a structured prompt defining 37 criteria across categories: data collection transparency, retention policies, third-party disclosure, rights facilitation, legal basis specification, etc.
- Response parsed into `criteria_scores_json` and `total_score`.
- Budget tracking updated in `budget_tracking` table.

**Circuit Breaker:** `circuit-breaker.js` wraps Claude API calls. Opens after configurable failure threshold.

**Data Interaction:** Results stored in `policy_analysis` table with `policy_type = 'privacy'`.

---

### 3.8 — Human-Assisted Consent Simulation

**Functional Description:** Opens a NEW non-headless browser window and pauses the audit, waiting for a human to interact with the cookie banner in each scenario (reject, then accept). Captures cookies and network requests in each scenario and computes a diff.

**Trigger Flow:** Step 16. Runs AFTER the main scan browser has been closed (Step 15).

**Execution Logic (`consent-simulator-v1.js`):**
- In server environments (Railway), `SKIP_CONSENT_CHECK=true` env var bypasses Step 16 entirely and returns `{ skipped: true }`.
- In local execution, launches a non-headless browser with `headless: false`.
- Scenario 1 (Reject): loads the URL in incognito context, CLI pauses for human to click Reject, captures state.
- Scenario 2 (Accept): new incognito context, CLI pauses for human to click Accept, captures state.
- Uses a simplified domain-based tracking filter (`TRACKING_DOMAINS` array with 4 domains: google-analytics.com, doubleclick.net, facebook.com, connect.facebook.net) — NOT the 5-layer categorizer.
- If the simulation cannot run (server environment), `runAssistedConsentSimulation()` returns `{ waiting: true }`, which causes the audit to set status to `PAUSED` and update `progress_json.state = 'WAITING_MANUAL_CONSENT'`.
- The frontend polls for this state and displays instructions. Resume is triggered via `POST /api/audit/:id/resume`.

**Risk:** The pause/resume flow is fragile. The browser closed at Step 15 cannot be resumed. The resume endpoint triggers a new partial scan. Network I/O timeout risks exist during the waiting state.

---

### 3.9 — Report Generation

**Functional Description:** Two report generation paths exist. The React-based path (PR #92) is the current production path.

**Execution Logic:**
- **React path (`react-report-renderer.js`):** Fetches all audit data from the database, calls `renderReactReportToHTML()` which launches a headless Chromium instance, navigates to the frontend's `/report-v2/:id` route (which renders the full React component tree server-side), captures the resulting HTML, optionally runs `page.pdf()` for PDF output, uploads to Vercel Blob, returns a shareable URL.
- **Legacy path (`html-report-builder.js`):** Handlebars template rendering. Still in the codebase, used by `GET /api/audit/:id/report`. Uses `buildMetricHierarchy()` (SSOT) for violation counts.

**Report Components (`frontend/components/report/`):** 14 React components: cover-page, executive-summary, scope-methodology, high-risk-finding, medium-findings, compliance-matrix, cookie-inventory, consent-mode-v2, privacy-policy-analysis, gdpr-precedents, next-steps, roadmap, sidebar-nav, report-section.

---

## STEP 4 — Cross-System Logic

### Shared Services

- **`createLogger(module)`** (`utils/logger.js`): Structured JSON logging to stdout. All modules use this. Format: `{ ts, level, event, ...data }`. Key for Railway log aggregation.
- **`getDatabase()`** (`database/db.js`): Returns the singleton SQLite connection. Used across all routes, scanners, and analyzers. Thread-safety is guaranteed by SQLite WAL mode + better-sqlite3's synchronous API.
- **`constants.js`** (`config/constants.js`): Central configuration: PORT, AUDIT_STATUS enums, ENABLE_SCREENSHOTS flag, API limits.
- **`requestIdMiddleware`** (`middleware/requestId.js`): Attaches a UUID to every request as `req.requestId` for log correlation.
- **`circuit-breaker.js`** / **`retry-handler.js`**: Shared resilience utilities for external API calls.

### Central Orchestration

`website-scanner.js:scanWebsite()` is the single orchestration point. It imports and calls all 14 analyzers and 6 scanner modules. It owns the progress state machine and the final result assembly object.

### Module Interaction Flow (logical)

```
audit.routes.js
  → scanWebsite() [website-scanner.js]
      → puppeteer-setup.js (browser)
      → network-monitor.js (request capture)
      → consent-monitor.js (storage write interception)
      → cookie-extractor.js (3 snapshots)
      → tracking-detector.js (client-side JS trackers)
      → cookie-banner-checker.js [→ noyb-violations.json]
      → consent-mode-detector.js
      → consent-mode-validator.js
      → vendor-fingerprinter.js [→ vendor-patterns.json]
      → timeline-builder.js
      → network-request-categorizer.js [→ detection-confidence.js]
      → correlateNetworkAndStorage() [inline]
      → SQLite (saveScanResults)
      → consent-simulator-v1.js
      → compliance-score-calculator.js
  → html-report-builder.js [→ confirmed-tracking-filter.js (SSOT)]
      → react-report-renderer.js (Puppeteer PDF)
      → blob-storage.js (Vercel)
```

---

## STEP 5 — Technical Sustainability Indicators

| Indicator | Status | Notes |
|---|---|---|
| Code modularity | Medium | Good folder separation. `website-scanner.js` is 980+ lines and imports 16 modules — high coupling in orchestrator |
| Separation of concerns | Partial | Analyzers are well-separated. Report building mixes data retrieval and template logic in `html-report-builder.js` |
| Maintainability | Medium | No TypeScript in backend. No unit tests detected. Heavy reliance on inline comments as documentation |
| Test coverage | None detected | No test files, no test scripts in `package.json` |
| Dependency management | Adequate | `package.json` pinned to major ranges. Puppeteer 23.x is a heavy dependency |
| Scalability readiness | Low | Single-process, SQLite database, synchronous Puppeteer per audit. Concurrent scans share the same Node.js event loop and SQLite file |
| Observability/logging | Good | Structured JSON logging via `createLogger()` across all modules. `requestIdMiddleware` for correlation. Budget tracking table |
| CI/CD | None detected | No `.github/workflows/` or similar. Deployments via Railway + Vercel CLI |
| Screenshot feature | Disabled | Hard-commented out with TODO notes. Represents incomplete feature |
| Error handling | Inconsistent | Try/catch in most places. Some exceptions silently convert to `skipped: true` in banner checks |

---

## STEP 6 — Final Structured Summary

### High-Level Architecture Summary

CraftPolicy GDPR Auditor is a monolithic, single-process Node.js application deployed on Railway. It uses Puppeteer as both its data collection engine (scanning) and its report rendering engine (PDF generation). The frontend is a stateless Next.js application on Vercel that proxies all API calls to the backend. SQLite provides persistence and is suitable for the current single-instance deployment model. The Claude AI API provides the only ML-based analysis component (privacy policy scoring).

### Key Strengths

- **Detailed analysis pipeline:** 17-step orchestrated scan with multiple analysis passes and cross-correlation (network + storage co-occurrence).
- **Structured logging:** Consistent JSON structured logging across all 50+ modules.
- **Public/private endpoint separation:** Report viewing is unauthenticated; write operations are protected.
- **Three-layer SSOT metric hierarchy (PR #90):** Establishes legally grounded, filterable violation counts with explicit GDPR Art. 5(1)(d) basis.
- **5-layer confidence scoring:** Replaces naive domain-matching with probabilistic categorization that accounts for blocked requests, consent pings, and resource loads.

### Critical Technical Debt

- **No test coverage:** Zero automated tests in a legal-evidence-producing system.
- **Monolithic scan function:** `scanWebsite()` is ~980 lines with 17 steps, 16 imports, and mixed concerns (scan, analysis, persistence, progress reporting).
- **Screenshots permanently disabled:** Feature is dead code with no timeline for re-enablement; its absence reduces evidence quality.
- **Consent simulation requires server interaction:** Step 16 (`consent-simulator-v1.js`) is fundamentally incompatible with headless server deployment and is bypassed via `SKIP_CONSENT_CHECK=true`. The pause/resume mechanism adds state complexity without delivering the feature.
- **SQLite as production database:** Acceptable for single-instance low-concurrency; becomes a hard blocker for any horizontal scaling.
- **Type I noyb check hardcoded disabled:** `checkViolation()` switch case for `type_i` returns `{ skipped: true }` unconditionally; the implementation function `checkMisclassifiedEssentialCookies()` exists but is never called from the scan pipeline.

### Sustainability Risk Indicators

- **Single point of failure:** Puppeteer crash in scan affects Express server stability.
- **Budget enforcement:** In-memory + SQLite daily budget cap is a weak control. Multi-instance deployment would break the per-day accumulation logic.
- **Migration strategy:** ALTER TABLE migrations run on every startup (guarded by PRAGMA checks). This is fragile for schema evolution under concurrent traffic.
- **Deprecation lag:** Legacy Handlebars report builder (`html-report-builder.js`) remains active alongside the new React renderer. Two report pipelines for the same output increase maintenance surface.

### Areas Requiring Deeper Audit

- **Claude API prompt design:** The 37-criterion privacy policy prompt is not visible in the repository (`prompts/` directory is `.gitkeep` only).
- **Vendor-patterns.json and tracking-domains.json:** The accuracy of these registries directly determines false positive/negative rates. Their provenance and update cadence are undocumented.
- **Detection-confidence.js L2–L5 implementation:** The scoring functions for entropy, behavioral clustering, and fingerprinting are referenced but not fully reviewed here.
- **Frontend data handling:** The `/app/api/proxy/route.js` forwards raw backend responses to the browser — no output sanitization or schema validation on the frontend.

---

## SPECIAL SECTION — Two Flagged Technical Problems

### Problem #1 — Numerical Inconsistency: 22 vs 18 vs 5

**What the three numbers represent in the codebase:**

**22 — Preliminary domain-based count (Step 8, pre-categorization):**
In `website-scanner.js` Step 8, `networkMonitor.getTrackingRequests()` is called. This returns requests where `isTrackingRequest()` in `network-monitor.js` returned `true`. `isTrackingRequest()` uses `isKnownTrackingDomain()` — a simple domain-suffix match against `tracking-domains.json` — with no confidence scoring, no response status check, and no resource type filter. This count is logged as a "preliminary" number and the code comments explicitly note: *"Final counts after re-categorization in Step 13.6 (excludes blocked requests)"*.

At Step 13.6, the variable `trackingRequests` is reassigned:
```js
trackingRequests = requestCategorization.trackingRequests;
```
This replaces the preliminary domain-matched array with the 5-layer categorized set. The preliminary 22 is logged for diagnostics but NOT used in the final report output.

**18 — Category A + B combined (Layer 2 in metric hierarchy):**
In `confirmed-tracking-filter.js:buildMetricHierarchy()`, `n2 = catA.length + catB.length`. Category B includes requests with confidence 40–69 (suspicious but unconfirmed). This is the Layer 2 "preliminary detection" count. It appears in the `funnelExplanation` text generated by `buildMetricHierarchy()` but is explicitly labeled as "not legally confirmed" in the code and in the report's methodology section. The report's `funnelExplanation` field specifically states this intermediate count.

**5 — Layer 3 confirmed violations (authoritative count):**
In `confirmed-tracking-filter.js:computeConfirmedTrackingViolations()`, requests must pass ALL of: (a) `beforeConsent === true`, (b) not a benign resource type (unless tracking pixel exception applies), (c) not a benign static extension (unless `.gif` tracking pixel exception), (d) Category A only (confidence ≥70). This is `n3`, stored in `layer3.count`. Only this number is used in the executive summary, compliance determination text, and critical violation descriptions in the report.

**When the SSOT was established:** PR #90 (commit `f3a14c0`, message: *"fix(metrics): establish SSOT for GDPR violation counts — GDPR Art. 5(1)(d)"*) introduced `confirmed-tracking-filter.js` and wired `buildMetricHierarchy()` into `html-report-builder.js`. Before this PR, the report used raw preliminary counts without the three-layer separation, which is the structural cause of the inconsistency described in the audit finding.

**Summary of the data path:**
- 22 = `network-monitor.js:isKnownTrackingDomain()` (Step 8) — domain-only, pre-response, not used in final output
- 18 = `network-request-categorizer.js` CategoryA.count + CategoryB.count (Step 13.6) — Layer 2, labeled "preliminary"
- 5 = `confirmed-tracking-filter.js:computeConfirmedTrackingViolations()` (report generation) — Layer 3, the only number used for compliance determination

---

### Problem #2 — noyb 8-Point Checklist: Actual vs Hardcoded Checks

**The configuration as it exists in the code:**

`analyzeCookieBanner()` in `cookie-banner-checker.js` iterates the 8 violation definitions from `noyb-violations.json` and calls `checkViolation(page, violation, ...)` for each. The `checkViolation()` function uses a `switch` statement on `violation.id`.

**Checks that ARE dynamically executed on the live page DOM (7 of 8):**

- **type_a:** Calls `checkNoRejectButton()`. First calls `waitForBannerVisible(page, 10000)` — a polling loop that searches for known CMP selectors (`#cookiescript_injected`, `#onetrust-banner-sdk`, `#CybotCookiebotDialog`, `[data-testid="uc-privacy-banner"]`) and generic selectors (`[id*="cookie"]`, `[class*="consent"]`, `[role="dialog"]`) in main document AND same-origin iframes, every 500ms for up to 10 seconds. Then searches all buttons (main doc + iframes + shadow DOM) for accept/reject by CSS attribute, id, className, and multi-language text keywords. If `waitForBannerVisible` times out without finding a banner, a warning is logged but the button search continues globally.

- **type_b:** `page.evaluate()` queries `input[type="checkbox"]:checked`, then filters out checkboxes whose label/name/id contains "necessary"/"essential"/"required".

- **type_c:** `page.evaluate()` finds accept BUTTON and settings A-tag, reads `window.getComputedStyle().fontSize` for both, checks ratio < 0.7.

- **type_d:** `page.evaluate()` reads `window.getComputedStyle().backgroundColor` for accept and reject buttons. Applies two strategies: (1) exact hex match against `color_patterns` from `noyb-violations.json`; (2) HSL analysis (accept: green 90–150° or blue 180–260°, saturation >40%, lightness 40–70%; reject: saturation <15% OR lightness >80%).

- **type_e:** `page.evaluate()` reads `offsetWidth * offsetHeight` (area), `fontWeight`, and padding for accept vs reject buttons. Violation if area ratio >1.3, weight difference >200, or padding ratio >1.5.

- **type_h:** `page.evaluate()` checks `document.body.innerText` for "legitimate interest" (+ multi-language variants from `noyb-violations.json:text_patterns`) AND advertising-context keywords.

- **type_k:** Searches footer/header/nav for links with `href*="cookie"` or `href*="privacy"`, floating buttons by CSS class patterns, and all links/buttons for multi-language cookie settings text.

**The check that is NOT executed (1 of 8 — hardcoded skip):**

- **type_i (Misclassified Essential Cookies):** In `checkViolation()`, the `case 'type_i':` block returns:
  ```js
  result = {
    detected: false,
    skipped: true,
    skipReason: 'Type I check disabled - requires CMP-specific category extraction',
    evidence: null
  };
  ```
  The function `checkMisclassifiedEssentialCookies(cookies, violation)` exists in the same file and contains a full implementation (filters cookies marked as `essential` or `necessary` and checks names against `tracking_patterns_forbidden`: `_ga`, `_gid`, `_fbp`, `_hjid`, `doubleclick`, `__gads`). However, `checkViolation()` never calls it. The `cookies` parameter is passed through to `analyzeCookieBanner()` and then to `checkViolation()`, but the switch case for `type_i` is a static return, not a function call.

**Timing context for all live checks:** All 7 active checks run on the same Puppeteer page instance that was used for the main scan, at Step 10 — after the page has loaded and after the 5-second async cookie wait (Step 5.7), but before any consent simulation (Step 16). The banner is expected to still be visible at this point because no consent action has been taken during the main scan session. The `waitForBannerVisible()` pre-check handles cases where the banner loads asynchronously.

**The `default` case in `checkViolation()`:** Any `violation.id` value not explicitly handled by the switch returns `{ detected: false, skipped: true, skipReason: 'Unknown violation type' }`. This means adding a new violation type to `noyb-violations.json` without updating the switch statement results in a silent skip, not an error.

---

*End of Report — 9 pages equivalent*
