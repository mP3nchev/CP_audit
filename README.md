# GDPR Privacy & Cookie Compliance Auditor

**Production Platform:** Professional GDPR compliance auditing system with hybrid cloud + local workflow for comprehensive cookie banner and privacy policy analysis.

**Live URLs:**
- 🌐 **Frontend:** https://cp-audit-dg6j.vercel.app/
- 🚀 **Backend API:** https://cpaudit-production.up.railway.app/

---

## 🎯 System Overview

**What It Does:**
- Performs 17-step GDPR compliance audits on any website
- Scans cookies, tracking, and consent banners automatically
- Analyzes Privacy & Cookie Policies with AI (37 GDPR criteria)
- Simulates manual consent (Reject vs Accept) with hybrid workflow
- Generates professional HTML reports with risk assessments

**Business Value:**
- Deliver $880 compliance audits in <3 hours (vs 3+ hours manual)
- Target: 50-200 audits/month at <$1/audit in API fees
- Professional reports with noyb checklist, Consent Mode V2 analysis, GDPR precedents

---

## 🏗️ Architecture

### **Deployment Stack**

| Component | Platform | Purpose |
|-----------|----------|---------|
| **Frontend** | Vercel | Next.js 14 app with real-time polling |
| **Backend** | Railway | Express.js API with Puppeteer (headless) |
| **Database** | SQLite | Single file DB on Railway volume |
| **Blob Storage** | Vercel Blob | Screenshot & report storage |
| **Local Script** | Windows | Manual consent simulation (headful Chrome) |

### **Technology Stack**

**Backend (Railway):**
- Node.js 20+ with Express.js
- Puppeteer 23+ (headless - no GUI on Railway)
- Claude Sonnet 4 API for policy analysis
- SQLite (better-sqlite3) for data persistence
- Vercel Blob for file storage

**Frontend (Vercel):**
- Next.js 14 (App Router)
- React 18+ with Tailwind CSS
- Chart.js for report visualizations
- Real-time audit status polling

**Local Script (Windows):**
- Puppeteer (headful mode - with GUI)
- Chrome DevTools Protocol (CDP) for cookie monitoring
- Uploads data to Railway API after manual interaction

---

## 📋 17-Step Audit Process

The audit runs through 17 steps. **Step 16 (Manual Consent Simulation)** requires human interaction and pauses the audit.

### **Steps 1-15: Automated (Railway)**

1. **Initialize Audit** - Create audit record
2. **Launch Browser** - Start Puppeteer instance
3. **Setup Monitoring** - Configure CDP for cookies/network
4. **Navigate to Website** - Load target URL
5. **Wait for Load** - Wait for page stability
6. **Detect Consent Banner** - Find cookie banner element
7. **Take Initial Screenshot** - Capture page state
8. **Detect Cookies Before Consent** - Record pre-consent cookies
9. **Analyze Banner Compliance** - Check GDPR requirements (8 criteria)
10. **Network Tracking Analysis** - Detect tracking before consent
11. **Consent Mode V2 Detection** - Check Google gtag configuration
12. **Timeline Violations** - Document timing of violations
13. **Cookie Categorization** - Classify cookies (essential/analytics/marketing)
14. **Technical Metadata** - Capture performance metrics
15. **Pre-Simulation Summary** - Prepare for manual consent test

### **Step 16: PAUSED - Manual Consent Simulation**

**Why This Pauses:**
- Railway has no GUI (headless Puppeteer)
- Consent banners require HUMAN interaction (detecting "Reject" button is unreliable)
- Need to test TWO scenarios: Reject vs Accept

**What Happens:**
1. ⏸️ Railway audit **PAUSES** (status: `PAUSED`)
2. Frontend shows **pause screen** with:
   - ⏸️ "Manual Consent Simulation Required" header
   - 📋 Instructions
   - **Copy command:** `node manual-consent-audit.js --url "https://example.com" --audit-id X --api-url https://cpaudit-production.up.railway.app`
   - ▶️ "Resume Audit" button
3. User copies command and runs **LOCALLY on Windows** in `backend/` folder
4. Chrome window opens (headful mode - user sees it)
5. User performs **manual interactions:**
   - **Reject Scenario:** Click Reject → script captures cookies/tracking
   - **Accept Scenario:** Reload page → Click Accept → script captures cookies/tracking
6. Script uploads data to Railway API (`POST /api/audit/manual-consent/upload`)
7. User clicks **"Resume Audit"** button in frontend
8. Railway backend validates data → continues to Step 17

### **Step 17: Finalization (Railway)**

17. **Comparison & Violations** - Analyze Reject vs Accept differences, generate violations report

**Audit Complete!** Report available at `/api/audit/:id/report`

---

## 🔄 Hybrid Workflow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER (Web Browser)                        │
│           https://cp-audit-dg6j.vercel.app/                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ 1. Start Audit
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              RAILWAY BACKEND (Cloud - Headless)              │
│      https://cpaudit-production.up.railway.app/              │
│                                                               │
│  Steps 1-15: Automated scanning                              │
│  - Puppeteer headless                                        │
│  - Cookie detection                                          │
│  - Banner analysis                                           │
│  - Network tracking                                          │
│                                                               │
│  Step 16: PAUSE ⏸️                                           │
│  - Set audit status = PAUSED                                 │
│  - Save partial results                                      │
│  - Return instructions to frontend                           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ 2. Frontend polls /status
                            │    Detects PAUSED state
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  FRONTEND (Pause Screen)                     │
│                                                               │
│  ⏸️  Manual Consent Simulation Required                     │
│  📋 Instructions:                                            │
│    1. Open terminal on LOCAL machine                         │
│    2. Navigate to backend/ folder                            │
│    3. Run command below                                      │
│    4. Interact with Chrome window                            │
│    5. Click "Resume Audit" when done                         │
│                                                               │
│  📋 Command:                                                 │
│  ┌─────────────────────────────────────────────┐            │
│  │ node manual-consent-audit.js \               │            │
│  │   --url "https://example.com" \              │            │
│  │   --audit-id X \                             │            │
│  │   --api-url https://cpaudit-production...    │   [Copy]   │
│  └─────────────────────────────────────────────┘            │
│                                                               │
│  ▶️  [Resume Audit Button]                                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ 3. User copies command
                            ▼
┌─────────────────────────────────────────────────────────────┐
│         LOCAL MACHINE (Windows - Headful Chrome)             │
│              C:\Users\user\Downloads\CP_audit\backend\       │
│                                                               │
│  PowerShell:                                                 │
│  > cd C:\Users\user\Downloads\CP_audit\backend               │
│  > node manual-consent-audit.js --url ... --audit-id X      │
│                                                               │
│  Chrome Window Opens 🪟:                                     │
│  - User sees the website                                     │
│  - Script waits for manual interaction                       │
│  - User clicks "Reject All" → Script captures data          │
│  - Page reloads                                              │
│  - User clicks "Accept All" → Script captures data          │
│  - Chrome closes                                             │
│                                                               │
│  Data Uploaded ✅:                                           │
│  POST https://cpaudit-production.up.railway.app/             │
│       /api/audit/manual-consent/upload                       │
│  Body: { reject: {...}, accept: {...} }                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ 4. User clicks "Resume Audit"
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              RAILWAY BACKEND (Resumes)                       │
│                                                               │
│  POST /api/audit/:id/resume                                  │
│  - Validates consent data uploaded                           │
│  - Continues from Step 17                                    │
│  - Analyzes Reject vs Accept                                 │
│  - Generates violations report                               │
│  - Marks audit COMPLETED                                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ 5. Frontend polls /status
                            │    Detects COMPLETED
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              FRONTEND (Shows Report)                         │
│                                                               │
│  ✅ Audit Complete                                           │
│  📊 View Report                                              │
│  📥 Download HTML                                            │
│  🔗 Share Link                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### **For Users (Running Audits)**

**Prerequisites:**
- Windows machine with Chrome installed
- Node.js 20+ installed locally
- Git (to clone repository)

**Steps:**

1. **Clone Repository:**
   ```bash
   git clone <repo-url>
   cd CP_audit
   ```

2. **Install Dependencies Locally:**
   ```bash
   cd backend
   npm install
   ```

3. **Start Audit on Frontend:**
   - Go to https://cp-audit-dg6j.vercel.app/
   - Enter website URL
   - Click "Start Audit"
   - Wait for audit to pause at Step 16

4. **When Frontend Shows Pause Screen:**
   - Copy the command from the yellow instruction box
   - Open PowerShell on Windows
   - Navigate to backend folder:
     ```powershell
     cd C:\path\to\CP_audit\backend
     ```
   - Paste and run the command
   - Chrome window will open - interact with cookie banner:
     - First: Click "Reject All" (or equivalent)
     - Then: Click "Accept All" (or equivalent)
   - Wait for script to finish (Chrome closes automatically)

5. **Resume Audit:**
   - Go back to frontend
   - Click "Resume Audit" button
   - Wait for audit to complete (~1-2 minutes)

6. **View Report:**
   - Click "View Report" to see full HTML report
   - Download or share as needed

---

## 🛠️ Development Setup

### **Backend (Railway)**

**Environment Variables (Railway Dashboard):**

```bash
NODE_ENV=production
PORT=3001
DATABASE_URL=./audits.db
CLAUDE_API_KEY=sk-ant-api03-xxxxx
CLAUDE_MODEL=claude-sonnet-4-20250514
VERCEL_BLOB_TOKEN=vercel_blob_xxxxx
PUPPETEER_TIMEOUT_MS=120000
PUPPETEER_HEADLESS=true
CONSENT_MODE=assisted
RAILWAY_ENVIRONMENT=production
PUBLIC_URL=https://cpaudit-production.up.railway.app
```

**Deploy to Railway:**
- Connected to GitHub repository
- Auto-deploys on push to `claude/gdpr-audit-system-S9hY6` branch
- Build command: `cd backend && npm install`
- Start command: `cd backend && npm start`

### **Frontend (Vercel)**

**Environment Variables (Vercel Dashboard):**

```bash
NEXT_PUBLIC_API_URL=https://cpaudit-production.up.railway.app
NEXT_PUBLIC_APP_NAME=GDPR Auditor
```

**Deploy to Vercel:**
- Connected to GitHub repository
- Auto-deploys on push to main branch
- Root directory: `frontend/`
- Framework preset: Next.js

### **Local Development**

**Backend (localhost):**

```bash
cd backend
npm install

# Create .env file
cat > .env << EOF
NODE_ENV=development
PORT=3001
DATABASE_URL=./audits.db
CLAUDE_API_KEY=sk-ant-api03-xxxxx
CLAUDE_MODEL=claude-sonnet-4-20250514
VERCEL_BLOB_TOKEN=vercel_blob_xxxxx
PUPPETEER_TIMEOUT_MS=120000
PUPPETEER_HEADLESS=true
CONSENT_MODE=assisted
EOF

npm start
```

**Frontend (localhost):**

```bash
cd frontend
npm install

# Create .env.local file
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_NAME=GDPR Auditor
EOF

npm run dev
```

**Local URLs:**
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

---

## 📁 Project Structure

```
CP_audit/
├── backend/
│   ├── src/
│   │   ├── server.js                 # Express server entry point
│   │   ├── routes/
│   │   │   ├── audit.routes.js       # Audit API endpoints
│   │   │   └── health.routes.js      # Health check endpoints
│   │   ├── scanners/
│   │   │   ├── website-scanner.js    # Main 17-step audit orchestrator
│   │   │   └── consent-simulator-v1.js # Railway pause logic
│   │   ├── analyzers/
│   │   │   ├── privacy-policy-analyzer.js    # 37 GDPR criteria
│   │   │   ├── cookie-banner-analyzer.js     # 8 banner criteria
│   │   │   ├── cookie-policy-comparator.js   # Declared vs detected
│   │   │   ├── risk-assessor.js              # GDPR fine calculations
│   │   │   └── solution-generator.js         # Recommendations
│   │   ├── generators/
│   │   │   └── html-report-builder.js        # Handlebars templates
│   │   ├── database/
│   │   │   ├── db.js                 # SQLite connection
│   │   │   └── schema.sql            # Database schema
│   │   └── config/
│   │       ├── constants.js          # Global config (includes PAUSED status)
│   │       └── error-codes.js        # Error handling
│   ├── scripts/
│   │   └── manual-consent-audit.js   # LOCAL Windows script (headful)
│   ├── audits.db                     # SQLite database (created on startup)
│   ├── .env                          # Environment variables (NOT in git)
│   └── package.json
│
├── frontend/
│   ├── app/
│   │   ├── page.jsx                  # Homepage
│   │   ├── components/
│   │   │   ├── AuditForm.jsx         # Start audit form + polling logic
│   │   │   ├── ResultsDisplay.jsx    # Pause screen + report display
│   │   │   ├── StatusBadge.jsx       # Visual status indicators
│   │   │   └── LoadingSpinner.jsx    # Loading states
│   │   ├── layout.jsx                # Root layout
│   │   └── globals.css               # Tailwind styles
│   ├── .env.local                    # Frontend env vars (NOT in git)
│   └── package.json
│
├── README.md                         # This file
├── TECHNICAL_SPECS.md                # Detailed technical documentation
└── TASK.md                           # Original task breakdown
```

---

## 📊 Database Schema

**SQLite Database (7 Tables):**

| Table | Purpose |
|-------|---------|
| `audits` | Main audit records (status, timestamps, scores) |
| `scan_results` | Cookie scan data, consent simulation JSON |
| `policy_analysis` | Privacy/Cookie policy AI analysis (37 criteria) |
| `cookie_comparisons` | Declared vs detected cookies |
| `risk_assessments` | GDPR risk levels & fine calculations |
| `api_costs` | Claude API usage tracking |
| `gdpr_precedents` | 1500+ GDPR enforcement precedents |

**Key Fields:**

**`audits` table:**
- `status`: pending | processing | **paused** | completed | failed
- `audit_uid`: Public-facing ID (e.g., `aud_fc7fbd67d0738441`)
- `progress_json`: Stores Step 16 pause state with instructions

**`scan_results` table:**
- `consent_simulation_json`: Stores Reject vs Accept comparison data
- `tracking_before_consent`: Boolean flag for GDPR violations

---

## 🔌 API Endpoints

### **Audit Lifecycle**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/audit/start` | Start new audit (Steps 1-15 auto-run) |
| `GET` | `/api/audit/:id/status` | Poll audit status (detects PAUSED state) |
| `POST` | `/api/audit/:id/resume` | Resume paused audit (after manual upload) |
| `GET` | `/api/audit/:id/results` | Get audit results JSON |
| `GET` | `/api/audit/:id/report` | View HTML report |
| `GET` | `/api/audit/:id/share` | Generate shareable report link |
| `GET` | `/api/audits` | List all audits (latest 50) |

### **Manual Consent Upload**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/audit/manual-consent/upload` | Upload consent simulation data from local script |

**Request Body:**
```json
{
  "auditId": "aud_fc7fbd67d0738441",
  "websiteUrl": "https://example.com",
  "scenarios": {
    "reject": {
      "before": { "cookies": [...], "trackingData": {...} },
      "after": { "cookies": [...], "trackingData": {...} }
    },
    "accept": {
      "before": { "cookies": [...], "trackingData": {...} },
      "after": { "cookies": [...], "trackingData": {...} }
    }
  },
  "metadata": {
    "timestamp": "2026-01-30T20:50:16.547Z",
    "userAgent": "Mozilla/5.0 ...",
    "duration": 45.3
  }
}
```

### **Policy Analysis**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/audit/:id/privacy-policy` | Upload Privacy + Cookie Policy files |
| `GET` | `/api/audit/:id/policy-analysis` | Get policy analysis results |

### **Health Checks**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Basic health check |
| `GET` | `/health/detailed` | Detailed system health (DB, API, storage) |

---

## 🎯 Key Features

### ✅ **Phase 1: Website Scanning (COMPLETE)**

- Puppeteer-based cookie detection
- Network request monitoring (before/after consent)
- Screenshot capture (full page + banner)
- 8-criteria consent banner analysis (noyb checklist)
- Timeline tracking for violations
- Consent Mode V2 detection (Google gtag)

### ✅ **Phase 2: Policy Analysis (COMPLETE)**

- 37 GDPR criteria evaluation with Claude Sonnet 4
- Supports PDF, DOCX, HTML policy files
- Privacy Policy + Cookie Policy analysis
- Scoring system (0-100%) with grade (A-F)
- Cost tracking per API call

### ✅ **Phase 3: Risk Assessment (COMPLETE)**

- GDPR fine calculations (€20M or 4% revenue)
- Cookie policy comparison (declared vs detected)
- Violation severity levels (low/medium/high/critical)
- Solution recommendations
- 1500+ precedents database

### ✅ **Phase 4: HTML Reports (COMPLETE)**

- Professional Handlebars templates
- Chart.js visualizations
- Responsive design
- Shareable links via Vercel Blob
- Export as standalone HTML

### ✅ **Phase 5: Hybrid Workflow (COMPLETE)**

- Railway cloud scanning (Steps 1-15)
- **PAUSED status** on Step 16
- Frontend pause screen with instructions
- Local Windows script for manual consent
- Upload → Resume → Complete flow

---

## 🔧 Configuration

### **CONSENT_MODE Setting**

In `backend/src/config/constants.js`:

```javascript
CONSENT_MODE: process.env.CONSENT_MODE || 'assisted',
// 'assisted' = Pause at Step 16 for manual upload
// 'headful' = Run Puppeteer in headful mode (local only)
```

**On Railway:** `CONSENT_MODE=assisted` (default)
**On Windows Local:** Can use `CONSENT_MODE=headful` for testing

### **Audit Status State Machine**

```
pending → processing → paused → processing → completed
                    ↓
                  failed
```

**Status Values:**
- `pending`: Audit created, not started
- `processing`: Steps 1-15 running OR Step 17 running
- **`paused`**: Waiting at Step 16 for manual consent upload
- `completed`: All 17 steps done
- `failed`: Error occurred

**Frontend State Mapping:**
- `INIT`: Audit just created
- `SCANNING`: Steps 1-15 in progress
- **`WAITING_MANUAL_CONSENT`**: Paused at Step 16 (shows pause screen)
- `DONE`: Report ready
- `FAILED`: Error

---

## 🧪 Testing

### **Full End-to-End Test**

1. **Start Audit:**
   ```bash
   curl -X POST https://cpaudit-production.up.railway.app/api/audit/start \
     -H "Content-Type: application/json" \
     -d '{"website_url": "https://www.craftpolicy.com"}'
   ```

2. **Poll Status (should return PAUSED):**
   ```bash
   curl https://cpaudit-production.up.railway.app/api/audit/aud_xxx/status
   ```

3. **Run Manual Script Locally:**
   ```bash
   cd backend
   node manual-consent-audit.js \
     --url "https://www.craftpolicy.com" \
     --audit-id aud_xxx \
     --api-url https://cpaudit-production.up.railway.app
   ```

4. **Resume Audit:**
   ```bash
   curl -X POST https://cpaudit-production.up.railway.app/api/audit/aud_xxx/resume
   ```

5. **Check Completion:**
   ```bash
   curl https://cpaudit-production.up.railway.app/api/audit/aud_xxx/status
   ```

6. **View Report:**
   ```bash
   curl https://cpaudit-production.up.railway.app/api/audit/aud_xxx/report
   ```

---

## 🚨 Troubleshooting

### **"Audit is not in paused state"**

**Cause:** Resume endpoint called before audit reached Step 16 or after already resumed.

**Fix:** Check audit status first:
```bash
curl https://cpaudit-production.up.railway.app/api/audit/aud_xxx/status
```
Status should be `"paused"` and state should be `"WAITING_MANUAL_CONSENT"`.

### **"request entity too large"**

**Cause:** Screenshot payloads exceed 50MB limit.

**Fix:** Already fixed in latest version. Global `express.json({ limit: '50mb' })` in `server.js`.

### **Windows: "Cannot find path backend/"**

**Cause:** Terminal opened in wrong directory.

**Fix:**
```powershell
# Find where you cloned the repo (check Downloads, Documents, Desktop)
cd C:\Users\YourName\Downloads\CP_audit\backend

# Or use File Explorer:
# 1. Navigate to CP_audit\backend folder
# 2. Click address bar and type "powershell"
# 3. Press Enter
```

### **Frontend Stuck on "Initializing audit..."**

**Cause:** Status endpoint not returning proper state.

**Fix:** Already fixed. Ensure Railway deployed latest version with:
- `progress_json` in SELECT query (audit.routes.js:153)
- Check for `PAUSED` status → returns `state: 'WAITING_MANUAL_CONSENT'` (audit.routes.js:183)

### **Manual Script: Chrome Doesn't Open**

**Cause:**
1. Puppeteer not installed locally
2. Chrome not installed on Windows
3. Wrong directory

**Fix:**
```bash
# Ensure in backend/ directory
cd backend

# Install dependencies
npm install

# Run script
node manual-consent-audit.js --url "..." --audit-id X --api-url https://...
```

### **"db.prepare is not a function"**

**Cause:** Using old code that imported `db` module instead of `getDatabase()` function.

**Fix:** Already fixed in all files. Ensure latest version deployed:
```javascript
// WRONG:
const db = require('../database/db');

// CORRECT:
const { getDatabase } = require('../database/db');
const db = getDatabase();
```

---

## 📈 Performance & Costs

**Audit Duration:**
- Steps 1-15 (automated): ~2-3 minutes
- Step 16 (manual): ~1-2 minutes (user interaction time)
- Step 17 (finalization): ~30 seconds
- **Total: ~4-6 minutes per audit**

**API Costs (Claude Sonnet 4):**
- Privacy Policy Analysis: $0.15-0.30
- Cookie Policy Comparison: $0.10-0.20
- Risk Assessment: $0.05-0.10
- Solution Generation: $0.08-0.15
- **Total per audit: ~$0.40-0.75**

**Target:** 50-200 audits/month = $20-150/month in API costs

---

## 🔐 Security & Privacy

**Data Handling:**
- All data stored in SQLite on Railway volume (private)
- Screenshots uploaded to Vercel Blob (private by default)
- No PII collected from websites
- Audit reports can be shared via secure Blob URLs

**API Security:**
- CORS enabled for Vercel frontend only
- Claude API key stored in Railway environment variables (not in code)
- No authentication required (internal tool)

---

## 🚀 Git Workflow

**Branch Strategy:**

```bash
# Development branch (auto-deploys to Railway)
git checkout claude/gdpr-audit-system-S9hY6

# Make changes
git add .
git commit -m "Description"

# Push to Railway (triggers auto-deploy)
git push -u origin claude/gdpr-audit-system-S9hY6
```

**Important:**
- Railway monitors `claude/gdpr-audit-system-S9hY6` branch
- Vercel monitors `main` branch
- All 40+ fixes from both chats are on `claude/gdpr-audit-system-S9hY6`

---

## 📖 Additional Documentation

- **TECHNICAL_SPECS.md** - Detailed technical specifications
- **TASK.md** - Original phase-by-phase implementation plan
- **backend/src/config/constants.js** - All configuration options
- **frontend/app/components/** - Frontend component documentation

---

## 🤝 Support

**For Issues:**
- Check Railway logs: https://railway.app/project/[project-id]
- Check Vercel logs: https://vercel.com/[project-name]
- Review error logs in Railway filesystem: `/app/logs/errors.log`

**Common Commands:**

```bash
# View Railway logs
railway logs

# Restart Railway service
railway up

# View local backend logs
cd backend && npm start

# View local frontend logs
cd frontend && npm run dev

# Check audit status
curl https://cpaudit-production.up.railway.app/api/audit/aud_xxx/status

# List all audits
curl https://cpaudit-production.up.railway.app/api/audits
```

---

## 📄 License

Proprietary - CraftPolicy 2026

---

**Built with ❤️ for CraftPolicy - Making GDPR Compliance Accessible**

**System Status:** ✅ All 17 steps operational | ⏸️ Hybrid workflow active | 🚀 Production ready
