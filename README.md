# GDPR Privacy & Cookie Compliance Auditor

Professional GDPR compliance auditing tool that scans websites for cookie/tracking violations and analyzes Privacy & Cookie Policies. Generate professional HTML reports with risk assessments and actionable recommendations.

## 🎯 Project Overview

**Business Goal:** Enable CraftPolicy to deliver $880 compliance audits in <3 hours (vs current 3+ hour manual process).

**Target:** 50-200 audits/month at <$1/audit in API fees

## 🏗️ Technology Stack

**Backend:**
- Node.js 20+ with Express.js
- Puppeteer 23+ for website scanning
- Claude Sonnet 4 API for policy analysis
- SQLite (better-sqlite3) for data storage
- Vercel Blob for screenshot storage

**Frontend:**
- Next.js 14+ (App Router)
- React 18+
- Tailwind CSS
- Chart.js for visualizations

## 📁 Project Structure

```
gdpr-audit-tool/
├── backend/              # Node.js Express backend
│   ├── src/
│   │   ├── server.js    # Main server file
│   │   ├── database/    # SQLite schema & connection
│   │   ├── routes/      # API routes
│   │   └── config/      # Configuration & constants
│   ├── audits.db        # SQLite database (created on startup)
│   ├── .env.example     # Environment variables template
│   └── package.json
│
├── frontend/            # Next.js frontend
│   ├── app/            # Next.js 14 App Router pages
│   ├── .env.local.example
│   └── package.json
│
├── TASK.md             # Detailed implementation tasks
├── TECHNICAL_SPECS.md  # Technical specifications
└── README.md           # This file
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ installed
- npm package manager
- Git

### Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env and add your API keys

# Start backend server
npm start
```

Backend will run on **http://localhost:3001**

### Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.local.example .env.local

# Start development server
npm run dev
```

Frontend will run on **http://localhost:3000**

## ✅ Phase 0: Project Setup - COMPLETE

**Status:** ✅ All tasks completed

### What's Been Set Up:

✅ Backend Express server with health endpoints
✅ SQLite database with complete schema
✅ Frontend Next.js app with Tailwind CSS
✅ Environment configuration files
✅ Project structure following VibeCoding principles

### Verify Installation:

1. **Backend Health Check:**
   ```bash
   curl http://localhost:3001/health
   ```
   Expected response:
   ```json
   {
     "status": "ok",
     "database": "connected",
     "timestamp": "2026-01-13T...",
     "responseTime": 5
   }
   ```

2. **Frontend:**
   Open http://localhost:3000 in browser
   - Should see "GDPR Auditor" homepage
   - API status should show "Connected"

3. **Database:**
   Check that `backend/audits.db` file exists

## 📊 Database Schema

The SQLite database includes 7 tables:

- `audits` - Main audit records
- `scan_results` - Cookie & network scan data
- `policy_analysis` - Privacy policy analysis results
- `cookie_comparisons` - Declared vs detected cookies
- `risk_assessments` - Risk calculations & fines
- `api_costs` - API usage tracking
- `gdpr_precedents` - GDPR enforcement precedents (1500+ records)

## 🔐 Environment Variables

### Backend (.env)

```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=./audits.db
CLAUDE_API_KEY=sk-ant-api03-xxxxx
CLAUDE_MODEL=claude-sonnet-4-20250514
VERCEL_BLOB_TOKEN=vercel_blob_xxxxx
PUPPETEER_TIMEOUT_MS=120000
PUPPETEER_HEADLESS=true
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_NAME=GDPR Auditor
```

## 📋 Development Phases

- ✅ **Phase 0:** Project Setup (COMPLETE)
- ⏳ **Phase 1:** Puppeteer Scanner (6-8 hours)
- ⏳ **Phase 2:** Privacy Policy Analysis (4-5 hours)
- ⏳ **Phase 3:** Technical Audits & Risk Assessment (8-10 hours)
- ⏳ **Phase 4:** HTML Report Generation (6-8 hours)
- ⏳ **Phase 5:** Frontend UI (5-6 hours)
- ⏳ **Phase 6:** Error Handling & Monitoring (2-3 hours)
- ⏳ **Phase 7:** Deployment & Testing (3-4 hours)

See **TASK.md** for detailed phase requirements.

## 🛠️ Development Principles

This project follows **VibeCoding** principles:

- ✅ Monolithic backend (no microservices)
- ✅ SQLite only (no PostgreSQL/Redis)
- ✅ Synchronous processing (<5 min per audit)
- ✅ Plain JavaScript (no TypeScript for MVP)
- ✅ Simple over complex
- ✅ Test on real websites

## 📖 API Endpoints

### Current Endpoints (Phase 0)

- `GET /` - API information
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system health

### Upcoming Endpoints

- `POST /api/audit/start` - Start new audit
- `GET /api/audit/:id/status` - Get audit status
- `GET /api/audit/:id/report` - Get HTML report

## 🧪 Testing

### Manual Testing Commands

```bash
# Test backend health
curl http://localhost:3001/health

# Test detailed health
curl http://localhost:3001/health/detailed

# Check database
ls -lh backend/audits.db
```

## 📝 Next Steps

1. ✅ Phase 0 complete - project initialized
2. ⏳ Proceed to Phase 1 - Implement Puppeteer scanner
3. ⏳ Add document parsers (PDF, Docx, HTML)
4. ⏳ Integrate Claude API with prompt caching
5. ⏳ Build HTML report generator

## 🤝 Contributing

This is an internal CraftPolicy project. Follow the phase-by-phase development plan in TASK.md.

## 📄 License

Proprietary - CraftPolicy 2026

## 🆘 Troubleshooting

### Backend won't start
- Check Node.js version: `node --version` (should be 20+)
- Verify all dependencies installed: `npm install`
- Check .env file exists and has valid values

### Frontend won't start
- Ensure backend is running first
- Check NEXT_PUBLIC_API_URL in .env.local
- Clear .next folder: `rm -rf .next && npm run dev`

### Database errors
- Delete audits.db and restart backend (will recreate)
- Check write permissions in backend directory

### API Connection Failed
- Verify backend is running on port 3001
- Check firewall settings
- Ensure no other service using port 3001

---

**Built with ❤️ for CraftPolicy - Making GDPR Compliance Accessible**
