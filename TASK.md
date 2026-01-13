# **TASK.md \- GDPR Privacy & Cookie Compliance Auditor**

## **🎯 MAIN OBJECTIVE**

Build a GDPR compliance auditing tool that scans websites for cookie/tracking violations and analyzes Privacy/Cookie Policies. Generate professional HTML reports with risk assessments and actionable recommendations.

**Business Goal:** Enable CraftPolicy to deliver $880 compliance audits in \<3 hours (vs current 3+ hour manual process).

---

## **📋 CONTEXT & CONSTRAINTS**

**Business:**

* B2B service for eCommerce/SaaS websites  
* Internal tool initially, client self-service later  
* Target: 50-200 audits/month  
* Cost: \<$1/audit in API fees

**Technical:**

* VibeCoding approach: monolithic, simple, fast  
* Single Node.js backend (no microservices)  
* SQLite database (no PostgreSQL/Redis/queues)  
* Process audits synchronously (\<5 min each)  
* Deploy: Railway (backend), Vercel (frontend)

**Critical Success:**

* Zero data loss (capture all cookies/requests)  
* 100% prompt accuracy (full 47-page prompt, no compression)  
* Professional output (expert-level reports)  
* Error resilience (retry logic for Puppeteer crashes)  
* Cost efficiency (\<$0.15/audit)

---

## **🏗️ TECHNOLOGY STACK**

**Backend:** Node.js 20+ | Express.js | Puppeteer 23+ | Claude Sonnet 4 API | SQLite (better-sqlite3) | Vercel Blob | mammoth \+ pdf-parse \+ cheerio

**Frontend:** Next.js 14+ (App Router) | React 18+ | Tailwind CSS | Chart.js | React Hook Form \+ Zod

**Infrastructure:** Railway (backend) | Vercel (frontend \+ Blob storage) | SQLite file | .env files

---

## **🔗 DEPENDENCY GRAPH**

START  
  ↓  
Phase 0: Setup (2-3h)  
  ↓  
  ├─→ Phase 1: Scanner (6-8h) ────┐  
  │                                ↓  
  └─→ Phase 2: Policy Analysis (4-5h) → Phase 3: Audits \+ Risk (8-10h)  
                                                   ↓  
                                          Phase 4: Report Gen (6-8h)  
                                                   ↓  
                                          Phase 5: Frontend (5-6h)  
                                                   ↓  
                                          Phase 6: Errors (2-3h)  
                                                   ↓  
                                          Phase 7: Deploy (3-4h)  
                                                   ↓  
                                                 DONE

Phase 1 & 2 can run in parallel after Phase 0\.  
Phase 3 requires data from BOTH Phase 1 & 2\.

All other phases are sequential.

---

## **❌ ANTI-PATTERNS (DO NOT DO THIS)**

**1\. Don't Create Microservices**

❌ Bad: /scanner-service, /analyzer-service, /report-service

✅ Good: Single /backend with /scanners, /analyzers, /generators folders

**2\. Don't Use Template Engines Initially**

❌ Bad: Installing Handlebars/EJS/Pug

✅ Good: String replacement or simple template literals for MVP

**3\. Don't Add External Services**

❌ Bad: PostgreSQL, Redis, RabbitMQ in Phase 0-3

✅ Good: SQLite \+ file storage, upgrade later if needed

**4\. Don't Optimize Prematurely**

❌ Bad: Implementing Redis cache, load balancers, worker pools

✅ Good: Synchronous processing, optimize after 100+ audits

**5\. Don't Abstract Too Early**

❌ Bad: Creating BaseScanner, AbstractAnalyzer classes

✅ Good: Concrete implementations first, refactor after patterns emerge

**6\. Don't Compress the Claude Prompt**

❌ Bad: Converting 47-page prompt to JSON/summarizing

✅ Good: Use FULL prompt with prompt caching enabled

**7\. Don't Dump Everything in utils/**

❌ Bad: /utils with 30 random helper files

✅ Good: Semantic folders: /scanners, /analyzers, /generators, /integrations

**8\. Don't Handle All Edge Cases Upfront**

❌ Bad: Supporting 50 file formats, handling every error

✅ Good: PDF/Docx/HTML only, add more if users need them

---

## **📁 PROGRESSIVE FILE STRUCTURE**

### **Phase 0: Foundation**

backend/  
├── src/  
│   ├── server.js          ← START HERE  
│   ├── routes/health.js  
│   └── database/  
│       ├── schema.sql  
│       └── db.js  
├── .env.example  
└── package.json

frontend/  
├── app/  
│   ├── layout.jsx  
│   └── page.jsx  
├── tailwind.config.js

└── package.json

### **Phase 1: Add Scanners**

backend/src/  
├── scanners/  
│   ├── puppeteer-setup.js  
│   ├── cookie-extractor.js  
│   ├── network-monitor.js  
│   └── screenshot-capture.js  
├── utils/  
│   └── retry-handler.js  
└── routes/

    └── audit.routes.js

### **Phase 2: Add Analyzers**

backend/  
├── prompts/  
│   └── privacy-policy-auditor-full.txt  ← Copy 47 pages here  
└── src/  
    ├── analyzers/  
    │   └── privacy-policy-analyzer.js  
    ├── integrations/  
    │   └── claude-api.js  
    └── utils/

        └── text-extractor.js

**Full structure in TECHNICAL\_SPECS.md**

---

## **🚀 DEVELOPMENT PHASES**

### **Phase 0: Project Setup (2-3 hours)**

**Objective:** Initialize monolithic project with all dependencies

**Tasks:**

1. Create backend: Express \+ Puppeteer \+ SQLite \+ document parsers  
2. Create frontend: Next.js \+ Tailwind \+ Chart.js  
3. 3\. Initialize SQLite with tables: audits, scan\_results, policy\_analysis, gdpr\_precedents Import /backend/src/config/gdpr-hub-precedents.csv into gdpr\_precedents table   
4. Setup `.env` files with placeholder keys  
5. Start servers: backend (3001), frontend (3000)  
6. Test health endpoint: `GET /health` returns `{"status": "ok"}`

**Success Criteria:**

* ✅ `npm start` works in both backend/frontend  
* ✅ Backend health endpoint responds in \<100ms  
* ✅ SQLite database file created with correct schema  
* ✅ No errors in console on startup  
* ✅ Frontend loads at localhost:3000

**Phase Start Checklist:**

□ Do you have Node.js 20+ installed?  
□ Should we use npm, yarn, or pnpm?  
□ Where should SQLite file be stored? (default: /backend/audits.db)

□ Any specific port preferences? (default: 3001 backend, 3000 frontend)

**Deliverables:** Working dev environment, all dependencies installed

**See TECHNICAL\_SPECS.md:** Database schema, package.json contents

---

### **Phase 1: Puppeteer Scanner (6-8 hours)**

**Objective:** Scan websites and capture cookies \+ network activity

**Tasks:**

1. Launch Puppeteer in stealth mode with retry logic  
2. Extract all cookies (name, domain, expiry, type, size)  
3. Monitor network requests with timestamps  
4. Detect tracking before consent (requests before banner)  
5. Capture screenshots (full page \+ cookie banner)  
6. Upload to Vercel Blob  
7. Store results in SQLite  
8. Create route: `POST /api/audit/start`

**Success Criteria:**

* ✅ Successfully scan 10 different test websites  
* ✅ Cookie count accuracy: ±2 vs manual Chrome DevTools check  
* ✅ Scan completes in \<3 minutes per site  
* ✅ Detect "tracking before consent" on 5 known violators  
* ✅ Screenshots uploaded and accessible via URL  
* ✅ 0 unhandled crashes in last 10 scans  
* ✅ Retry logic works: force 1 timeout, verify 3 retry attempts

**Phase Start Checklist:**

□ Is Vercel Blob token configured? (test with dummy upload)  
□ Do you understand "tracking before consent"? (explain detection method)  
□ Should we use headless or headful mode for debugging?  
□ What user-agent string to use? (default: GDPR-Auditor-Bot/1.0)

□ Any specific websites to test on? (provide 3-5 URLs)

**Deliverables:** Working scanner with retry logic, data in SQLite

**See TECHNICAL\_SPECS.md:** Puppeteer config, cookie detection rules, known tracking domains

---

### **Phase 2: Privacy Policy Analysis (4-5 hours)**

**Objective:** Integrate Claude API for 37-criteria analysis

**Tasks:**

1. Copy full 47-page prompt to `/backend/prompts/privacy-policy-auditor-full.txt`  
2. Implement Claude API client with **prompt caching** (critical\!)  
3. Build text extractors: PDF (pdf-parse), Docx (mammoth), HTML (cheerio)  
4. Handle file uploads with multer  
5. Call API, parse JSON response, validate 37 criteria present  
6. Store in `policy_analysis` table  
7. Create route: `POST /api/audit/:id/privacy-policy`

**Success Criteria:**

* ✅ Claude API responds with all 37 criteria (verify count)  
* ✅ First request costs \~$0.09, subsequent \<$0.01 (cached)  
* ✅ Extract text from sample PDF/Docx/HTML (verify readability)  
* ✅ API handles 429 rate limit with retry (simulate)  
* ✅ Total analysis time \<60 seconds  
* ✅ Final score calculation matches manual check (±2%)  
* ✅ Top 5 recommendations are relevant (manual review)

**Phase Start Checklist:**

□ Is Claude API key valid? (test with simple "hello" request)  
□ Did you copy the FULL 47-page prompt without modifications?  
□ Is prompt caching enabled? (check API request has cache\_control)  
□ Do text extraction libs work? (test with sample PDF/Docx)

□ Do you understand the scoring system? (explain Tier 1 vs Tier 4 weights)

**Deliverables:** Claude integration with \<$0.10/analysis cost

**See TECHNICAL\_SPECS.md:** 37 criteria list, scoring methodology, prompt caching setup

---

### **Phase 3: Technical Audits & Risk Assessment (8-10 hours)**

**Objective:** Implement noyb checklist, cookie comparison, risk scoring

**Tasks:**

1. Create `noyb-violations.json` with 8 violation types  
2. Analyze cookie banner: DOM checks for noyb patterns  
3. Validate Google Consent Mode v2 implementation  
4. Parse Cookie Policy document (upload separate from Privacy Policy)  
    \- Extract declared cookies via Claude API  
   \- Match declared vs detected by name/domain  
   \- Identify undeclared cookies, missing cookies  
   \- Store in cookie\_comparisons table  
5. Query GDPR Hub precedents database by violation articles \+ jurisdiction  
6. Calculate risk fines using statistical analysis (P25/P50/P75) \+ apply multipliers  
   \-   Return risk range \+ top 3-5 cited precedent  
7. Generate personalized solutions (Claude API optional)  
8. Calculate Overall Compliance Score (1-100):  
      \- Privacy Policy: 35% weight  
      \- Cookie Banner: 30% weight  
      \- Technical Implementation: 20% weight  
      \- Cookie Policy Accuracy: 15% weightЮ  
      \- Apply critical violation caps (tracking before consent → cap at 55\)

**Success Criteria:**

* ✅ Detect all 8 noyb violations on test sites (manual verification)  
* ✅ Consent Mode v2 detection: 90%+ accuracy (test on 20 sites)  
* ✅ Cookie comparison: identify 100% of undeclared cookies  
* ✅ Risk assessment matches real DPA precedents (cite sources)  
* ✅ Solutions are actionable (not generic advice)  
* ✅ Process all checks in \<60 seconds  
* ✅ Banner screenshot highlights violations (visual proof)  
* ✅ Overall score calculation accurate (manual verification on 5 test sites)  
* ✅ Critical violation caps work correctly (tracking before consent \= max 55 score)

**Phase Start Checklist:**

□ Do you have Phase 1 scan results available? (show sample cookie data)  
□ Do you have Phase 2 policy analysis available? (show sample criteria)  
□ Understand noyb violations? (explain Type A vs Type B)  
□ Should risk calculations use conservative or aggressive estimates?

□ Need Claude API for solution personalization? (costs \+$0.03/audit)

**Deliverables:** Complete audit with risk scores and solutions

**See TECHNICAL\_SPECS.md:** noyb 8-point checklist, risk matrix, solution templates

---

### **Phase 4: HTML Report Generation (6-8 hours)**

**Objective:** Create professional, interactive HTML reports

**Tasks:**

1. Build HTML template with 8 sections (see TECHNICAL\_SPECS.md)  
2. Embed CSS inline (Tailwind compiled)  
3. Generate Chart.js visualizations (risk pie, criteria bar, timeline)  
4. Add interactive features: search, filter, sort tables  
5. Create self-contained HTML (all assets inline)  
6. Upload to Vercel Blob with shareable URL  
7. Create routes: `GET /api/audit/:id/report`, `GET /api/audit/:id/share`

**Success Criteria:**

* ✅ Report loads in \<2 seconds (test on slow 3G)  
* ✅ Lighthouse score: 90+ Performance, 100 Accessibility  
* ✅ Render correctly in Chrome/Firefox/Safari  
* ✅ Charts interactive with hover tooltips  
* ✅ Table filter/sort works without page reload  
* ✅ Share link works in incognito mode (no auth required)  
* ✅ HTML file size \<5MB  
* ✅ Passes WCAG 2.1 AA contrast check

**Phase Start Checklist:**

□ Review color palette preferences? (see TECHNICAL\_SPECS.md)  
□ Show me sample audit data? (verify structure matches expectations)  
□ Need PDF export in Phase 4 or can it wait? (adds 2 hours)  
□ Should charts be static images or interactive? (interactive default)

□ Any specific report sections to prioritize? (order matters)

**Deliverables:** Beautiful HTML report with all sections working

**See TECHNICAL\_SPECS.md:** Report sections, color palette, chart configs, example mockup

---

### **Phase 5: Frontend UI (5-6 hours)**

**Objective:** Build internal audit request interface

**Tasks:**

1. Create home page with audit form  
2. File upload component (drag-and-drop)  
3. Form validation (React Hook Form \+ Zod)  
4. Loading state with progress indicator  
5. Report viewer page (iframe embed)  
6. API client for backend communication  
7. Apply design system (blues, amber, status colors)

**Success Criteria:**

* ✅ Form validates before submit (show error messages)  
* ✅ File upload accepts PDF/Docx/HTML only  
* ✅ Loading screen shows status updates every 30s  
* ✅ Report displays correctly in iframe  
  ✅ Download button works (HTML)  
* ✅ Share link copies to clipboard  
* ✅ Mobile responsive (test on 375px width)  
* ✅ No console errors on any page

**Phase Start Checklist:**

□ Backend API is running and accessible?  
□ Confirm API endpoints? (POST /audit/start, GET /audit/:id/report)  
□ Should users authenticate? (no auth for MVP default)

□ Any branding requirements? (logo, colors \- see TECHNICAL\_SPECS.md)

**Deliverables:** Functional UI for starting audits and viewing reports

**See TECHNICAL\_SPECS.md:** Form validation rules, UI components, color system

---

### **Phase 6: Error Handling & Monitoring (2-3 hours)**

**Objective:** Production-ready error handling

**Tasks:**

1. Global error handler with user-friendly messages  
2. Health check endpoint (database, API, blob storage)  
3. Environment variable validation on startup  
4. Screenshot failures for debugging

**Success Criteria:**

* ✅ Invalid URL shows friendly error (not 500\)  
* ✅ Timeout shows "Site too slow" not crash  
* ✅ Health check detects missing API key immediately  
* ✅ 0 uncaught exceptions in 50 test audits  
* ✅ Error screenshots saved to /logs folder

**Phase Start Checklist:**

□ How to handle concurrent audits? (queue or reject?)

**Deliverables:** Robust error handling, monitoring active

**See TECHNICAL\_SPECS.md:** Error codes, retry logic, health check spec

---

### **Phase 7: Deployment & Testing (3-4 hours)**

**Objective:** Deploy to production and verify

**Tasks:**

1. Deploy backend to Railway with env vars  
2. Deploy frontend to Vercel with API\_URL  
3. End-to-end test on 10 real websites  
4. Verify costs: should be \<$0.15/audit average  
5. Test error scenarios (timeouts, invalid URLs)  
6. Optimize: enable caching, compress images  
7. Write documentation (README, API docs, troubleshooting)

**Success Criteria:**

* ✅ Backend health check: [https://your-app.railway.app/health](https://your-app.railway.app/health) returns 200  
* ✅ Frontend loads: [https://your-app.vercel.app](https://your-app.vercel.app)  
* ✅ 10 successful audits completed end-to-end  
* ✅ Average cost: $0.10-0.15/audit (log all API calls)  
* ✅ Average time: 3-5 minutes/audit  
* ✅ 0 deployment errors in logs  
* ✅ Documentation complete (others can run it)  
* ✅ Rollback plan documented

**Phase Start Checklist:**

□ Railway account ready? (credit card for beyond free tier?)  
□ Vercel account connected to GitHub?  
□ All env vars documented? (list them)  
□ Have 10 test websites ready? (provide URLs)

□ Should we setup custom domain? (optional)

**Deliverables:** Live production system, documentation complete

---

## **📊 COST MONITORING SPECIFICATION**

**Create:** `/backend/logs/api-costs.json`

**Log Format:**

json  
{  
  "timestamp": "2026-01-13T10:30:00Z",  
  "audit\_id": "aud\_123",  
  "phase": "privacy\_policy\_analysis",  
  "input\_tokens": 32000,  
  "output\_tokens": 3200,  
  "cached\_tokens": 28800,  
  "cost\_usd": 0.045,  
  "model": "claude-sonnet-4-20250514"  
}  
\`\`\`

\*\*Alert Thresholds:\*\*  
\- If single audit \> $0.20 → Log WARNING  
\- If cached\_tokens \= 0 after first request → Log ERROR (caching broken\!)  
\- If average cost \> $0.15 over 10 audits → STOP and notify user

\*\*Dashboard:\*\* After each audit, console.log:  
\`\`\`  
Audit Complete | Cost: $0.11 | Cached: 90% | Time: 4m 23s

Total Today: 12 audits | Avg Cost: $0.13 | Total: $1.56

---

## **🎬 EXECUTION STRATEGY**

**Default Behavior:**

* Use tools to explore code before asking questions  
* Always create actual files (never just show code)  
* Test each phase before moving to next  
* If something fails, debug thoroughly

**When to Ask:**

* Business logic is ambiguous  
* Multiple valid approaches exist  
* **Always ask at start of each phase** (use checklist)

**Code Standards:**

* Plain JavaScript (no TypeScript for MVP)  
* Clear naming (`scanWebsite()` not `scan()`)  
* Comments only for complex business logic  
* Manual testing (automated tests later)

---

## **🚨 CRITICAL REMINDERS**

1. **Use FULL 47-page prompt** with caching (saves 90% cost)  
2. **Monolithic backend** \- no microservices  
3. **SQLite only** \- no PostgreSQL  
4. **Retry logic** for all Puppeteer operations (3 attempts)  
5. **Log API costs** after every Claude call  
6. **Semantic folders** (/scanners, /analyzers, /generators)  
7. **Test on real websites** \- not just examples  
8. **Ask before each phase** \- use checklists above

---

## **✅ FINAL CHECKLIST**

* 10+ websites scanned successfully  
* Privacy Policy returns all 37 criteria  
* noyb checklist accurate (manual verify)  
* Cookie comparison identifies mismatches  
* Risk fines match real precedents  
* HTML report loads \<2s, Lighthouse 90+  
* Charts render and are interactive  
* Tables filter/sort correctly  
* Share links work  
* Error handling prevents crashes  
* Average cost \<$0.15/audit  
* Average time \<5 min/audit  
* Backend live on Railway  
* Frontend live on Vercel  
* Health check returns green  
* Documentation complete

---

**Ready to build.** Start with Phase 0\. Use Phase Start Checklists. Test thoroughly before moving forward.

