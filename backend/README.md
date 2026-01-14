# GDPR Auditor Backend

Node.js Express backend for GDPR compliance auditing.

## Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start server
npm start

# Development mode (with auto-reload)
npm run dev
```

## API Endpoints

### Health Check
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system information

### Audit Routes (Coming in Phase 1)
- `POST /api/audit/start` - Start new audit
- `GET /api/audit/:id/status` - Get audit status
- `GET /api/audit/:id/report` - Get HTML report

## Project Structure

```
backend/
├── src/
│   ├── server.js           # Main Express server
│   ├── database/
│   │   ├── schema.sql      # Database schema
│   │   └── db.js           # Database connection
│   ├── routes/
│   │   └── health.routes.js # Health check routes
│   ├── config/
│   │   └── constants.js    # Configuration constants
│   ├── scanners/           # Puppeteer scanners (Phase 1)
│   ├── analyzers/          # Policy analyzers (Phase 2-3)
│   ├── generators/         # Report generators (Phase 4)
│   ├── integrations/       # External APIs (Claude, Blob)
│   ├── utils/              # Utility functions
│   └── middleware/         # Express middleware
├── prompts/                # Claude prompts
├── templates/              # Report templates
├── logs/                   # Application logs
├── audits.db              # SQLite database (auto-created)
├── .env                    # Environment variables
└── package.json
```

## Environment Variables

Required variables in `.env`:

```bash
# Server
NODE_ENV=development
PORT=3001

# Database
DATABASE_URL=./audits.db

# Claude API (required for Phase 2)
CLAUDE_API_KEY=sk-ant-api03-xxxxx
CLAUDE_MODEL=claude-sonnet-4-20250514

# Vercel Blob (required for Phase 1)
VERCEL_BLOB_TOKEN=vercel_blob_xxxxx

# Puppeteer
PUPPETEER_TIMEOUT_MS=120000
PUPPETEER_HEADLESS=true
```

## Testing

```bash
# Test health endpoint
curl http://localhost:3001/health

# Expected response
{
  "status": "ok",
  "database": "connected",
  "uptime": 10.5,
  "responseTime": 5
}
```

## Database

SQLite database with 7 tables:
- `audits` - Main audit records
- `scan_results` - Cookie scanning data
- `policy_analysis` - Privacy policy scores
- `cookie_comparisons` - Cookie policy comparison
- `risk_assessments` - Risk & fine calculations
- `api_costs` - API usage tracking
- `gdpr_precedents` - GDPR enforcement data

Database is automatically created on first run.
