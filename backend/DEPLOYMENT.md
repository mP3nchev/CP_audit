# Deployment Guide - GDPR Auditor Backend

## Prerequisites

### Required System Packages

The backend requires **Chromium** or **Chrome** browser for Puppeteer scanning:

#### Railway / Linux Deployment

Add to your Railway buildpack or Dockerfile:

```bash
# For Ubuntu/Debian
apt-get update
apt-get install -y \
    chromium-browser \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils
```

#### Alternative: Use Puppeteer's Browser Install

```bash
# In your deployment script
cd backend
npx puppeteer browsers install chrome
```

### Environment Variables

Required environment variables in production:

```bash
# Server
NODE_ENV=production
PORT=3001

# Database (will be created automatically)
DATABASE_URL=./audits.db

# Claude API (required for Phase 2+)
CLAUDE_API_KEY=sk-ant-api03-your-actual-key

# Vercel Blob Storage (required for Phase 1+)
VERCEL_BLOB_TOKEN=vercel_blob_rw_your-actual-token

# Puppeteer
PUPPETEER_TIMEOUT_MS=120000
PUPPETEER_HEADLESS=true
```

## Railway Deployment

### Step 1: Create Railway Project

```bash
# Install Railway CLI
npm install -g railway

# Login
railway login

# Create new project
railway init
```

### Step 2: Configure Build

Create `Procfile`:
```
web: cd backend && npm start
```

Create `railway.json`:
```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "cd backend && npm install"
  },
  "deploy": {
    "startCommand": "cd backend && npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Step 3: Add Environment Variables

```bash
railway variables set NODE_ENV=production
railway variables set PORT=3001
railway variables set CLAUDE_API_KEY=sk-ant-api03-...
railway variables set VERCEL_BLOB_TOKEN=vercel_blob_rw_...
railway variables set PUPPETEER_HEADLESS=true
```

### Step 4: Deploy

```bash
railway up
```

## Docker Deployment (Alternative)

Create `Dockerfile` in backend directory:

```dockerfile
FROM node:20-slim

# Install Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start server
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t gdpr-auditor-backend .
docker run -p 3001:3001 \
    -e CLAUDE_API_KEY=sk-ant-api03-... \
    -e VERCEL_BLOB_TOKEN=vercel_blob_rw_... \
    gdpr-auditor-backend
```

## Troubleshooting

### Puppeteer Fails to Launch

**Error:** "Could not find browser"

**Solution:**
1. Ensure Chromium is installed: `which chromium-browser`
2. Set explicit path in `.env`:
   ```
   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
   ```
3. Update `puppeteer-setup.js` to use executablePath:
   ```javascript
   executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
   ```

### Database Errors

**Error:** "SQLITE_CANTOPEN"

**Solution:**
- Ensure write permissions in backend directory
- Check DATABASE_URL path is writable
- For Railway: database persists in /app directory

### Out of Memory

**Error:** "JavaScript heap out of memory"

**Solution:**
- Increase Railway memory allocation
- Add NODE_OPTIONS environment variable:
  ```bash
  NODE_OPTIONS=--max-old-space-size=2048
  ```

### Blob Upload Fails

**Error:** "BLOB_UPLOAD_FAILED"

**Solution:**
- Verify VERCEL_BLOB_TOKEN is correct
- Check Vercel Blob storage limits
- Ensure network connectivity to Vercel

## Health Checks

Test deployment health:

```bash
# Basic health check
curl https://your-app.railway.app/health

# Detailed health check
curl https://your-app.railway.app/health/detailed

# Test audit endpoint
curl -X POST https://your-app.railway.app/api/audit/start \
  -H "Content-Type: application/json" \
  -d '{"website_url": "https://example.com"}'
```

## Performance Tuning

### Optimize for Production

1. **Enable clustering** (optional for multiple CPUs):
   ```javascript
   // Add to server.js
   const cluster = require('cluster');
   const numCPUs = require('os').cpus().length;

   if (cluster.isMaster && process.env.NODE_ENV === 'production') {
     for (let i = 0; i < numCPUs; i++) {
       cluster.fork();
     }
   } else {
     // Start server
   }
   ```

2. **Limit concurrent scans**:
   ```javascript
   // Add rate limiting middleware
   const rateLimit = require('express-rate-limit');

   app.use('/api/audit/start', rateLimit({
     windowMs: 60000, // 1 minute
     max: 5 // max 5 scans per minute
   }));
   ```

3. **Monitor memory usage**:
   ```javascript
   setInterval(() => {
     const used = process.memoryUsage();
     console.log(`Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
   }, 30000);
   ```

## Production Checklist

- [ ] Chrome/Chromium installed and accessible
- [ ] All environment variables configured
- [ ] VERCEL_BLOB_TOKEN valid and tested
- [ ] Database directory writable
- [ ] Health endpoint returns 200
- [ ] Successfully completed test audit
- [ ] Logs properly configured
- [ ] Error monitoring setup (Sentry, etc.)
- [ ] Backup strategy for SQLite database

---

**Need Help?** Check Railway logs: `railway logs`
