# CraftPolicy — GDPR Compliance Auditor
## Technical Architecture & Sustainability Report
**Prepared for:** Architectural Sustainability Review
**Analysis Date:** February 2026
**Target Reviewer:** Claude Opus 4.6
**Source:** Direct codebase analysis — `/home/user/CP_audit`

---

## 1. System Overview

### 1.1 Platform Purpose

CraftPolicy is an automated GDPR and ePrivacy compliance auditing platform for websites. Its primary purpose is to detect, classify, and report on privacy violations occurring on a target website — specifically pre-consent tracking, cookie banner non-compliance, privacy policy deficiencies, and Google Consent Mode V2 misconfiguration.

The platform is designed to generate legally defensible audit reports suitable for use as evidence in Data Protection Authority (DPA) complaints or regulatory proceedings. It combines automated headless browser scanning with Claude AI-powered document analysis and a human-assisted consent simulation pathway.

**Target users:** Privacy compliance consultants, DPO teams, legal departments, GDPR auditors. The platform operates as a B2B SaaS tool under the CraftPolicy brand.

**Business logic summary:** A user submits a website URL → the system autonomously scans it for tracking violations → the user uploads legal documents (privacy policy, cookie policy) → the system generates a structured compliance score and a detailed HTML report with evidence, legal citations, and remediation guidance.

### 1.2 Technology Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js (CommonJS modules) |
| Backend framework | Express 4.x |
| Browser automation | Puppeteer 23.x (headless Chromium) |
| Database | SQLite via better-sqlite3 9.x (synchronous, embedded) |
| AI integration | Anthropic Claude API (claude-sonnet-4-x, prompt caching) |
| Document parsing | pdf-parse, mammoth (DOCX), cheerio (HTML) |
| Template engine | Handlebars 4.x (legacy HTML report) |
| Frontend framework | Next.js 15 (App Router) + React 18 |
| UI components | Radix UI primitives + shadcn/ui + Tailwind CSS 3 |
| Charting | Chart.js 4, Recharts 2 |
| Blob storage | Vercel Blob (report sharing) |
| Deployment | Backend → Railway; Frontend → Vercel |
| TypeScript | Frontend only (backend is plain JS) |

---

## 2. Architecture & Structure

### 2.1 Project Structure

```
CP_audit/
├── backend/                    # Node.js/Express API server
│   ├── src/
│   │   ├── server.js           # Application entry point
│   │   ├── routes/
│   │   │   ├── audit.routes.js # All audit API endpoints (11 routes)
│   │   │   └── health.routes.js
│   │   ├── scanners/           # Puppeteer-based data capture
│   │   │   ├── website-scanner.js        # Orchestrator (~700 lines)
│   │   │   ├── puppeteer-setup.js
│   │   │   ├── network-monitor.js
│   │   │   ├── cookie-extractor.js
│   │   │   ├── tracking-detector.js
│   │   │   ├── screenshot-capture.js
│   │   │   ├── consent-simulator.js
│   │   │   └── consent-simulator-v1.js   # Human-assisted path
│   │   ├── analyzers/          # Post-capture analytical engines
│   │   │   ├── detection-confidence.js   # 5-layer scoring engine
│   │   │   ├── network-request-categorizer.js
│   │   │   ├── confirmed-tracking-filter.js  # SSOT (added recently)
│   │   │   ├── cookie-banner-checker.js
│   │   │   ├── consent-mode-detector.js
│   │   │   ├── consent-mode-validator.js
│   │   │   ├── consent-monitor.js
│   │   │   ├── privacy-policy-analyzer.js    # Claude API consumer
│   │   │   ├── cookie-policy-comparator.js
│   │   │   ├── timeline-builder.js
│   │   │   ├── risk-assessor.js
│   │   │   ├── vendor-fingerprinter.js
│   │   │   ├── gdpr-precedents-search.js
│   │   │   ├── solution-generator.js
│   │   │   └── compliance-score-calculator.js
│   │   ├── generators/         # Report rendering
│   │   │   ├── html-report-builder.js    # Handlebars/legacy path
│   │   │   └── report-data-adapter.js    # v2 React path data model
│   │   ├── integrations/
│   │   │   ├── claude-api.js             # Anthropic API + budget tracker
│   │   │   └── blob-storage.js           # Vercel Blob uploads
│   │   ├── middleware/
│   │   │   ├── auth.js                   # X-API-Key (timing-safe)
│   │   │   ├── error-handler.js
│   │   │   └── file-upload.js            # multer config
│   │   ├── database/
│   │   │   ├── db.js                     # SQLite singleton
│   │   │   ├── schema.sql                # 6-table schema
│   │   │   ├── migrate-add-scoring.js
│   │   │   └── migrate-add-monitoring.js
│   │   ├── config/
│   │   │   ├── constants.js
│   │   │   ├── tracking-domains.json     # ~200 vendor domains
│   │   │   ├── vendor-patterns.json
│   │   │   ├── vendor-payload-patterns.json
│   │   │   └── noyb-violations.json      # 8-point checklist
│   │   └── utils/
│   │       ├── circuit-breaker.js
│   │       ├── retry-handler.js
│   │       ├── error-logger.js
│   │       ├── schema-validator.js
│   │       └── text-extractor.js
│   └── templates/
│       └── gdpr-report-template.html     # Handlebars report (~1,300 lines)
└── frontend/                   # Next.js App Router
    ├── app/
    │   ├── page.jsx                      # Audit submission form
    │   ├── report/[id]/page.jsx          # Legacy HTML report viewer
    │   ├── report-v2/[id]/page.jsx       # v2 React report renderer
    │   └── api/proxy/route.js            # API proxy (avoids CORS)
    ├── components/report/                # v2 report section components
    └── types/report.ts                   # TypeScript data model
```

### 2.2 Backend Architecture

The backend follows a **layered monolithic** pattern with clear separation between data capture (scanners), analytical processing (analyzers), and report generation (generators). There is no microservice decomposition. All processing runs within a single Node.js process.

**Request lifecycle model:** Audit operations are **fire-and-forget** at the HTTP layer. `POST /api/audit/start` responds immediately with an audit ID while the full scan pipeline executes asynchronously via an unstructured promise chain. Progress is tracked via a `progress_json` column updated inline during scanning.

**Three-phase execution model:**
- **Phase 1 (automated):** Puppeteer scan + network capture + screenshot + banner check + consent mode detection
- **Phase 2 (user-triggered):** Privacy/cookie policy upload → Claude API analysis
- **Phase 3 (auto-triggered after Phase 2):** Risk assessment + cookie comparison + compliance scoring

A fourth optional pathway exists for **human-assisted consent simulation** — the audit pauses (`PAUSED` status), an external Puppeteer script (`manual-consent-audit.js`) runs locally, uploads JSON data to the API, and the audit resumes from a saved checkpoint (Step 17).

### 2.3 Database Structure

SQLite with `better-sqlite3` (synchronous driver). 6 tables:

| Table | Purpose | Key Columns |
|---|---|---|
| `audits` | Audit lifecycle record | `audit_uid`, `status`, `overall_score`, `progress_json` |
| `scan_results` | All Phase 1 outputs | 14 JSON blob columns (cookies, requests, timeline, vendors, etc.) |
| `policy_analysis` | Claude analysis results | `criteria_scores_json`, `percentage`, `policy_text` |
| `cookie_comparisons` | Policy vs. reality gap | `declared_cookies_json`, `undeclared_cookies_json` |
| `risk_assessments` | Financial risk estimate | `violations_json`, `total_risk_min`, `total_risk_max` |
| `gdpr_precedents` | DPA case reference data | `dpa`, `fine_eur`, `relevant_articles`, `summary` |

The schema is **document-oriented within a relational store** — most analytical data is stored as serialised JSON blobs rather than normalised columns. This avoids schema migrations for evolving analytical outputs but eliminates SQL-level queryability on those fields.

### 2.4 API Layer

REST API, 11 routes on a single Express router (`audit.routes.js`). All `/api/*` routes require `X-API-Key` header authenticated via timing-safe comparison. No GraphQL, no WebSockets.

Key routes: `POST /api/audit/start`, `GET /api/audit/:id/status`, `GET /api/audit/:id/report`, `GET /api/audit/:id/report-v2`, `GET /api/audit/:id/share`, `POST /api/audit/:id/privacy-policy`, `POST /api/audit/manual-consent/upload`.

### 2.5 Frontend Architecture

Next.js 15 with App Router. Two parallel report rendering paths coexist:
- `/report/[id]` — fetches and displays the raw HTML blob from the backend Handlebars renderer (iframe or injected)
- `/report-v2/[id]` — fetches JSON from `/api/audit/:id/report-v2` and renders it via a React component tree (12 section components)

The v2 frontend uses shadcn/ui (Radix UI + Tailwind) with Chart.js and Recharts for data visualisation. A Next.js API proxy route (`app/api/proxy/route.js`) forwards requests to the Railway backend to bypass browser CORS restrictions.

---

## 3. Functional Module Decomposition

### 3.1 Module A — Website Scanner Orchestrator

**Functional description:** The central orchestrator (`website-scanner.js`, ~700 lines) coordinates all Phase 1 activities in a defined sequential pipeline. It manages the Puppeteer browser lifecycle, orders all sub-scanners, handles progress tracking, and persists results to SQLite.

**Trigger:** Called asynchronously from `audit.routes.js` after audit record creation. No job queue — direct Promise invocation.

**Execution logic (step-by-step pipeline):**
1. Launch headless Chromium (`puppeteer-setup.js` — configures stealth flags, viewport, user agent)
2. Inject consent monitoring wrapper (`consent-monitor.js` — monkey-patches `gtag`, `dataLayer`, `document.cookie`, `localStorage`)
3. Setup network monitoring (`network-monitor.js` — intercepts all requests via `page.on('request')` and `page.on('response')`, records URL, headers, resource type, response status, and timing relative to consent event)
4. Navigate to target URL with timeout handling
5. Wait for page stability (DOM + network idle)
6. Detect consent banner appearance time (DOM mutation observer injected via `timeline-builder.js`)
7. Inject tracking detector (`tracking-detector.js` — JS injection that observes `_fbq`, `ga`, `gtag`, `dataLayer`, analytics objects)
8. Extract cookies (`cookie-extractor.js` — reads `document.cookie`, classifies by name patterns, assigns vendor/purpose/category)
9. Capture screenshots (`screenshot-capture.js` — full page + banner crop), upload to Vercel Blob
10. Analyse cookie banner (`cookie-banner-checker.js` — checks noyb 8-point checklist against DOM)
11. Detect Google Consent Mode V2 (`consent-mode-detector.js` — inspects `gtag` calls, `gcs`/`gcd` params)
12. Validate consent mode configuration (`consent-mode-validator.js`)
13. Categorise network requests (`network-request-categorizer.js` — 5-layer confidence scoring)
14. Fingerprint vendors (`vendor-fingerprinter.js` — matches request patterns against `vendor-patterns.json`)
15. Build event timeline (`timeline-builder.js` — correlates cookies, requests, consent events by timestamp)
16. Extract monitoring data (`consent-monitor.js` — collects intercepted `gtag` calls, storage writes)
17. Run automated consent simulation (`consent-simulator-v1.js` — clicks Reject/Accept buttons, records post-consent state)
18. Calculate compliance score (`compliance-score-calculator.js`)
19. Persist all results to `scan_results` table (14 JSON columns)

**Data interaction:** Single write to `scan_results` at pipeline completion. Progress updates written to `audits.progress_json` incrementally during execution.

**Technical risks:** The pipeline is entirely synchronous within a single async function — a failure at step 10 aborts steps 11-19 with no partial recovery. There is no job queue, no retry per step, and no timeout per stage. A single Puppeteer crash fails the entire audit silently (caught at the top-level promise, status updated to `failed`).

---

### 3.2 Module B — 5-Layer Tracking Detection Engine

**Functional description:** The detection confidence engine (`detection-confidence.js`) performs probabilistic classification of each network request to determine whether it constitutes a GDPR-relevant pre-consent tracking event. Replaces binary domain-matching (which carried 25-35% false-positive rate per code comments).

**Trigger:** Called from `network-request-categorizer.js` for each captured network request.

**Execution logic — 5 scoring layers (weighted sum):**

| Layer | Weight | Signal Type | Logic |
|---|---|---|---|
| L4 Semantic | 35% | Vendor + endpoint | Domain registry match + tracking path match (e.g. `/collect`, `/tr`, `/bat.gif`) |
| L2 Entropy | 25% | Payload analysis | Detects identity-bearing parameters (30+ regex patterns: `cid`, `fbp`, `_hjid`, `gclid`, `uuid`, etc.) |
| L1 Protocol | 15% | HTTP patterns | Pixel/beacon/GIF patterns, 1x1 image dimensions, beacon API calls |
| L3 Behavioral | 15% | Timing + frequency | Pre-consent firing, high-frequency same-domain bursts |
| L5 Fingerprint | 10% | Browser capabilities | Query params `sr` (screen res), `sd` (color depth), `ul` (language), `je` (Java) |

**Threshold classification:**
- Score ≥ 70 → Category A (Definite Tracking — reportable GDPR violation)
- Score 40-69 → Category B (Suspicious — requires manual verification)
- Score < 40 → Category C (Benign)

**Special case handling:** Google Consent Mode pings (requests containing `gcs`/`gcd`/`npa` params with denied-consent GCS values like `G100`) are explicitly excluded from violation classification — they indicate consent signalling, not data collection.

**SSOT enforcement (recently added):** `confirmed-tracking-filter.js` applies a final legal qualification pass on top of the categoriser: only Category A requests that also satisfy `beforeConsent === true`, pass resource type exclusions (images, fonts, CSS), and pass extension exclusions (`.webp`, `.woff2`, etc.) count as confirmed Layer 3 violations. This module is the **Single Source of Truth** for all violation counts used in report generation.

---

### 3.3 Module C — Privacy Policy Analyzer (Claude API)

**Functional description:** Evaluates an uploaded privacy policy document against 37 GDPR compliance criteria across 4 tiers (Tier 1: Data Controller Identity; Tier 2: Legal Basis & Processing Purposes; Tier 3: Data Subject Rights; Tier 4: Technical & Operational). Returns a percentage score, per-criterion pass/fail, and remediation recommendations.

**Trigger:** `POST /api/audit/:id/privacy-policy` — user uploads PDF, DOCX, or HTML file.

**Execution logic:**
1. `text-extractor.js` dispatches to `pdf-parse` (PDF), `mammoth` (DOCX), or `cheerio` (HTML) based on file extension, returns raw text
2. Text is cleaned/normalised (whitespace, boilerplate removal)
3. Length guard: minimum 500 chars enforced; maximum 500,000 chars (truncated)
4. `claude-api.js → analyzePrivacyPolicy()` constructs a structured prompt with the policy text, sends to Claude API with **prompt caching** enabled on the 37-criteria instruction block (Anthropic cache_control: ephemeral)
5. Claude returns a structured JSON response with per-criterion scores
6. `schema-validator.js` validates the response structure before persistence
7. Results written to `policy_analysis` table
8. **Circuit breaker** (`circuit-breaker.js`): 3 failure threshold, 120-second reset. If open, falls back to `buildFallbackAnalysis()` (zero scores with explanatory message)

**Cost control:** An in-memory daily budget tracker in `claude-api.js` (`dailySpent` variable) enforces a configurable USD cap (`DAILY_BUDGET_USD` from constants). Exceeded budget → HTTP 429 on new audit starts. **Critical limitation:** This tracker is process-scoped and resets on server restart — no persistence guarantees.

**External call:** Anthropic API (`https://api.anthropic.com/v1/messages`), model `claude-sonnet-4-x`. 90-second AbortController timeout. Retry handler (`retry-handler.js`) wraps transient 5xx errors with exponential backoff.

---

### 3.4 Module D — Cookie Banner Compliance Checker

**Functional description:** Evaluates the website's cookie consent banner against the noyb 8-point checklist, which maps directly to GDPR Art. 7(4), ePrivacy Directive, and EDPB Guidelines 05/2020.

**Trigger:** Called inline during Phase 1 scan pipeline from `website-scanner.js`.

**Execution logic:** `cookie-banner-checker.js` analyses the rendered DOM via Puppeteer page evaluation. Checks include:
- Presence of a clearly labelled Reject/Accept button on the first layer
- Visual prominence parity between Reject and Accept (size, color weight)
- Absence of pre-ticked checkboxes
- No deceptive dark patterns (accept button styled more prominently)
- Granular category controls accessible
- Banner re-appearance on withdrawal

Results stored as `banner_violations_json` in `scan_results`. Violations reference the `noyb-violations.json` config which maps violation IDs to legal articles and DPA precedents.

---

### 3.5 Module E — Consent Simulation (Human-Assisted)

**Functional description:** Simulates user Reject and Accept interactions to verify that the consent mechanism has real effect — i.e., fewer/no tracking cookies after Reject, and correct additional cookies after Accept. Two pathways exist:

- **Automated v1** (`consent-simulator-v1.js`): Puppeteer clicks detected Reject/Accept buttons automatically, records post-click cookie state. Used for banners where button selectors can be auto-detected.
- **Human-assisted** (`manual-consent-audit.js`): External script run locally by an operator with a visible (headful) Chromium window. Operator interacts with the banner manually, then script uploads `{ websiteUrl, scenarios: { reject, accept } }` JSON to `POST /api/audit/manual-consent/upload`. The audit enters `PAUSED` status, waits for the upload, then resumes via `POST /api/audit/:id/resume`.

**Violation detection in simulation results:**
- Tracking cookies present after Reject (`_ga`, `_gid`, `_fbp`, `_hjid`, `doubleclick`, `_utm`) → critical violation
- Accept and Reject produce identical cookie sets → consent mechanism ineffective (GDPR Art. 4(11))
- Click count imbalance > 0 → dark pattern (GDPR Art. 7(3))

---

### 3.6 Module F — Risk Assessment & Compliance Scoring

**Functional description:** Translates detected violations into financial risk exposure (EUR fine range) and an overall compliance score (0-100, graded A-F).

**Risk assessment (`risk-assessor.js`):** Maps violation types (tracking before consent, missing reject button, incomplete privacy policy, etc.) to fine ranges based on GDPR Art. 83 scales. Aggregates into `total_risk_min` / `total_risk_max`. Uses `solution-generator.js` (Claude API call) to produce remediation recommendations.

**Compliance score (`compliance-score-calculator.js`):** 4-component weighted calculation:
- Privacy Policy analysis: 35% (dynamic weight if absent)
- Cookie banner compliance: 30%
- Technical implementation (tracking before consent, consent mode): 20%
- Cookie policy accuracy: 15%

Weights redistribute dynamically if Privacy Policy or Cookie Policy data is not available. Score stored in `audits.overall_score` and `audits.score_grade`.

**Critical flaw (now resolved):** Prior to the SSOT fix, the violation count used in risk summaries was sourced from unqualified raw data (`timelineData.violations.length`, mixing cookie events and unfiltered network requests). This has been corrected to use the Layer 3 confirmed violation count exclusively.

---

### 3.7 Module G — Report Generation (Dual Path)

**Functional description:** The system maintains two parallel report rendering paths, serving different use cases.

**Path 1 — Handlebars HTML Report** (`html-report-builder.js`):
- `generateReport(auditUid)` reads all data from SQLite via `gatherAuditData()`, transforms it via `transformDataForTemplate()`, renders `gdpr-report-template.html` using Handlebars
- Output: self-contained HTML with inline Chart.js charts, sent as `text/html`
- Shareable via Vercel Blob upload (`/api/audit/:id/share`)

**Path 2 — v2 React Report** (`report-data-adapter.js`):
- `adaptAuditDataToReportModel(auditUid)` produces a structured JSON object matching TypeScript interface `ReportData` defined in `frontend/types/report.ts`
- Served from `GET /api/audit/:id/report-v2`
- Consumed by the Next.js frontend at `/report-v2/[id]` — 12 React section components render the data
- Report sections: Cover Page, Executive Summary, Scope & Methodology, Finding 1 (Tracking), Finding 2 (Banner), Medium Findings, Cookie Inventory, Consent Checklist, Compliance Matrix, Privacy Policy Analysis, Consent Mode V2, Human-Assisted Analysis

**Data governance (SSOT enforcement):** Both paths now import `buildMetricHierarchy()` from `confirmed-tracking-filter.js`. Layer 3 confirmed violation count is the only number used in executive summary, findings, risk classification, and conclusion sections. Layers 1 and 2 appear only in the Methodology funnel explanation section.

---

### 3.8 Module H — GDPR Precedents Search

**Functional description:** Enriches reports with relevant DPA enforcement cases from the embedded `GDPR Decisions Database - 2023-2025.csv` (loaded into the `gdpr_precedents` SQLite table at startup).

**Trigger:** Called from `report-data-adapter.js` during report generation.

**Execution logic (`gdpr-precedents-search.js`):** Given the set of detected violations (tracking before consent, banner issues, undeclared cookies, etc.), queries the precedents table by `relevant_articles` and `jurisdiction` matching. Returns top cases ranked by `fine_eur` descending. Wrapped in try/catch — failure is non-fatal (returns empty result set).

---

## 4. Cross-System Interaction & Shared Services

### 4.1 Data Flow Diagram (Logical)

```
[Browser Client]
    │
    ▼
[Next.js Frontend / Vercel]
    │  POST /api/audit/start  (proxied via /api/proxy)
    ▼
[Express Backend / Railway]
    │
    ├─► [SQLite DB] ─── audit record created (PROCESSING)
    │
    └─► [website-scanner.js] (async, fire-and-forget)
            │
            ├─► [puppeteer-setup.js] → headless Chromium launch
            ├─► [consent-monitor.js] → JS injection (gtag wrapper)
            ├─► [network-monitor.js] → request interception
            ├─► [cookie-extractor.js] → cookie classification
            ├─► [screenshot-capture.js] → [Vercel Blob]
            ├─► [cookie-banner-checker.js] → noyb 8-point check
            ├─► [consent-mode-detector.js] → Consent Mode V2 audit
            ├─► [network-request-categorizer.js]
            │       └─► [detection-confidence.js] → 5-layer scoring
            ├─► [vendor-fingerprinter.js]
            ├─► [timeline-builder.js]
            ├─► [consent-simulator-v1.js]
            └─► [compliance-score-calculator.js]
                    │
                    ▼
            [SQLite: scan_results]
                    │
    ┌───────────────┘
    │  POST /privacy-policy (user action)
    ▼
[privacy-policy-analyzer.js]
    │  └─► [claude-api.js] → [Anthropic API]
    │          (circuit breaker + budget tracker)
    ▼
[SQLite: policy_analysis]
    │
    └─► [Phase 3 async]
            ├─► [cookie-policy-comparator.js]
            ├─► [risk-assessor.js]
            ├─► [solution-generator.js] → [Anthropic API]
            └─► [compliance-score-calculator.js]
                    │
                    ▼
            [SQLite: cookie_comparisons, risk_assessments]
            [audits: overall_score updated]
                    │
    ┌───────────────┘
    │  GET /report or /report-v2
    ▼
[html-report-builder.js] OR [report-data-adapter.js]
    └─► [confirmed-tracking-filter.js] (SSOT — both paths)
    └─► [gdpr-precedents-search.js]
    └─► rendered HTML / JSON → client
```

### 4.2 Shared Services

- **`confirmed-tracking-filter.js`:** Shared by both report rendering paths. Single authoritative source for Layer 3 violation count and filter logic.
- **`claude-api.js`:** Single module managing all Anthropic API calls. Circuit breaker and budget tracker are singleton instances (process-scoped).
- **`db.js`:** SQLite connection singleton using `better-sqlite3`. Exposes `getDatabase()` — called directly in all modules needing DB access (no ORM, no repository pattern).
- **`constants.js`:** Centralized configuration for audit statuses, error codes, port, budget limits, timeouts.

---

## 5. Security & Access Control

**Authentication:** All `/api/*` routes require `X-API-Key` header. Comparison uses `crypto.timingSafeEqual` with fixed-length padding to prevent timing attacks. HMAC-SHA256 signature verification is implemented but reserved for future webhook use.

**CORS:** Strict allowlist enforced at server startup from `CORS_ALLOWED_ORIGINS` env var. Blocked origins receive 204 with no CORS headers — treated by browsers as CORS rejection. Server-to-server calls (no `Origin` header) pass through.

**Input validation:** URL format validated via `new URL()`. File uploads limited by multer (type + size). Policy text minimum/maximum length enforced.

**Blob URL protection:** Screenshot URLs stored in DB are never exposed directly to clients. A proxy route (`GET /api/audit/:id/screenshot/:type`) streams blob content through the server.

**Secrets management:** `CLAUDE_API_KEY`, `VERCEL_BLOB_TOKEN`, `INTERNAL_API_KEY` required as env vars. Server refuses to start if absent. No secrets in codebase.

**Gaps:** No rate limiting per client IP on audit creation (budget check is aggregate, not per-client). No input sanitisation against SSRF on the `website_url` field — any URL accessible from the Railway host will be scanned. No audit-level access control — any client with a valid API key can retrieve any audit by UID.

---

## 6. Technical Sustainability Evaluation

### 6.1 Code Modularity — GOOD
Clear separation between scanners, analyzers, generators, and integrations. Each module has a single explicit responsibility. The `confirmed-tracking-filter.js` addition demonstrates awareness of the cross-cutting concern problem and resolves it correctly.

### 6.2 Separation of Concerns — PARTIAL
The report generation layer (`html-report-builder.js`, `report-data-adapter.js`) handles data transformation, presentation logic, and legal classification simultaneously. The dual-path report architecture (Handlebars + React v2) creates maintenance overhead — data transformation logic is duplicated between the two paths.

### 6.3 Maintainability — MODERATE RISK
- No TypeScript on the backend — all analytical functions lack type contracts
- No automated tests visible (no `test/`, no `__tests__/`, no test runners in `package.json`)
- The main scanner orchestrator (`website-scanner.js` ~700 lines) is a monolithic sequential function with no sub-step abstraction
- Several `// TODO` markers in production code (e.g. `clickCount`, `SSRF` mention in manual consent upload)
- Two `console.log` styles coexist: structured JSON (`process.stdout.write(JSON.stringify(...))`) in security-sensitive modules vs. plain `console.log` in business logic

### 6.4 Test Coverage — ABSENT
No test files detected in any directory. No test scripts in `package.json`. The absence of automated testing for a legally-sensitive system is a high-severity sustainability risk. Changes to scoring logic or filter criteria cannot be validated without re-running live audits.

### 6.5 Dependency Management — MODERATE
No `package-lock.json` dependency pinning visible (npm) for exact version reproducibility. Backend has 13 production dependencies — lean and appropriate. Frontend has 70+ dependencies (Radix UI primitives, shadcn/ui components) — typical for modern React but introduces surface area. Puppeteer `^23.0.0` is a major dependency that downloads a full Chromium binary (~280MB) on install — relevant for Railway deployment.

### 6.6 Scalability Readiness — LOW
SQLite with `better-sqlite3` (synchronous) is the primary bottleneck. SQLite allows only one writer at a time — concurrent Puppeteer scans (which are CPU and I/O intensive) will queue on the database write lock. No horizontal scaling is possible without migrating to PostgreSQL or MySQL. The Puppeteer process is resource-intensive (headless Chromium, ~200MB RAM per instance) — concurrent audit processing on a single Railway container will create memory pressure. No job queue (no Bull, no BullMQ, no worker_threads) — audit processing occurs in the main Express event loop thread, potentially blocking request handling during Puppeteer operations.

### 6.7 Observability & Logging — BASIC
Structured JSON logging exists in security modules (`auth.js`, `circuit-breaker.js`). Business logic uses plain `console.log`. No log aggregation service configured. No distributed tracing. No application performance monitoring. Progress tracking via `progress_json` column provides basic audit-level visibility. The `error-logger.js` utility exists but its integration depth is unclear.

### 6.8 CI/CD — NOT DETECTED
No `.github/workflows/`, no `Dockerfile` explicitly defined (though `nixpacks.toml` for Railway and `railway.json` and `vercel.json` for deployment are present). Deployment is platform-managed (Railway for backend, Vercel for frontend) via git push. No automated testing, linting, or security scanning in the deployment pipeline.

---

## 7. Final Structured Summary

### 7.1 Architecture Summary
CraftPolicy is a well-structured, feature-complete GDPR audit SaaS with a clear domain model. The core technical innovation — the 5-layer probabilistic tracking detection engine — is sophisticated and legally grounded. The system correctly separates data capture (Puppeteer), analytical classification (confidence scoring), AI-powered document review (Claude API), and report generation (dual Handlebars/React path). The recent addition of a Single Source of Truth metric module (`confirmed-tracking-filter.js`) demonstrates architectural maturity and legal awareness.

### 7.2 Key Strengths
1. **Forensically defensible detection logic** — 5-layer confidence scoring with explicit Consent Mode exclusion, category thresholds tied directly to legal standard (DPA-suitable evidence at Category A ≥70)
2. **AI document analysis with resilience** — Claude API integration with circuit breaker, fallback analysis, and budget control
3. **Dual report path** — Handlebars for immediate HTML delivery + React v2 for interactive, shareable reports
4. **Security fundamentals** — timing-safe authentication, strict CORS, blob URL proxying, secrets via env vars
5. **Legal grounding** — noyb 8-point checklist, GDPR precedents database, legal citations in all violation descriptions

### 7.3 Critical Technical Debt
1. **No automated tests** — the entire scoring, filtering, and reporting logic is untested; regression risk is high with any scoring change
2. **SQLite single-writer bottleneck** — not viable for concurrent production load; migration to PostgreSQL is required before scaling
3. **Dual report paths with separate data transformation** — `html-report-builder.js` and `report-data-adapter.js` duplicate significant transformation logic; divergence risk is ongoing
4. **In-memory budget tracker** — resets on server restart, creating cost control blind spots; needs database persistence
5. **No per-step recovery in scanner pipeline** — a failure at any pipeline step aborts the entire audit with no partial result preservation

### 7.4 Sustainability Risk Indicators
| Risk | Severity | Area |
|---|---|---|
| No test coverage | HIGH | All analytical modules |
| SQLite concurrency | HIGH | Database layer |
| Dual report path divergence | MEDIUM | Report generators |
| In-memory budget tracker | MEDIUM | Claude API integration |
| No job queue for Puppeteer scans | MEDIUM | Scanner orchestrator |
| No SSRF protection on target URL | MEDIUM | Audit route input validation |
| Monolithic scanner function | LOW | `website-scanner.js` |
| No audit-level access control | LOW | API authorization |

### 7.5 Areas Requiring Deeper Audit
1. **Detection confidence calibration:** The 5-layer weights (L4=35%, L2=25%, etc.) appear empirically set. A validation study against known-good and known-bad request sets would quantify actual false-positive/false-negative rates.
2. **Consent Mode detection reliability:** `consent-mode-detector.js` inspects `gtag` JavaScript calls — sites using server-side GTM or delayed script loading may evade detection.
3. **Cookie classification accuracy:** Cookie categorisation in `cookie-extractor.js` relies on name-pattern matching (e.g. `_ga` → Analytics). Sites using obfuscated or first-party proxied tracking cookies will produce incorrect categories.
4. **Human-assisted pathway robustness:** The `PAUSED` → `RESUME` state machine has no timeout — an audit can remain paused indefinitely. No cleanup job exists for stale paused audits.
5. **Puppeteer anti-detection efficacy:** Headless detection countermeasures in `puppeteer-setup.js` (stealth flags, user agent spoofing) may be bypassed by sophisticated consent banner implementations that behave differently under automation.

---

*Report generated from direct codebase analysis. All file and function references are accurate at the time of analysis (February 2026, branch: `claude/gdpr-tracking-audit-LwZ7N`).*
