# Railway Deployment Guide - Backend

## Първоначална конфигурация

### 1. Railway Project Setup

1. Влез в Railway: https://railway.app
2. Създай нов проект: "New Project" → "Deploy from GitHub repo"
3. Избери repository: `mP3nchev/CP_audit`
4. Важно: Задай **Root Directory** на `backend`

### 2. Environment Variables (ЗАДЪЛЖИТЕЛНИ!)

В Railway → Project → Variables, добави следните променливи:

```bash
# Node.js
NODE_ENV=production
PORT=3001

# Database (SQLite ще се създаде автоматично)
DATABASE_URL=./audits.db

# Claude API (ЗАДЪЛЖИТЕЛНА!)
CLAUDE_API_KEY=sk-ant-api03-xxxxx
CLAUDE_MODEL=claude-sonnet-4-20250514

# Vercel Blob Storage (ЗАДЪЛЖИТЕЛНА!)
VERCEL_BLOB_TOKEN=vercel_blob_xxxxx

# Puppeteer
PUPPETEER_TIMEOUT_MS=120000
PUPPETEER_HEADLESS=true
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/nix/store/*-chromium-*/bin/chromium

# Rate Limiting
RATE_LIMIT_WINDOW_MS=3600000
RATE_LIMIT_MAX_REQUESTS=10
```

### 3. Build Configuration

Railway автоматично ще детектира конфигурацията от:
- `backend/railway.json` - Deployment settings
- `backend/nixpacks.toml` - Build instructions

**Build процес:**
1. Install Node.js 20 и Chromium
2. Run `npm install`
3. Start с `npm start` (което е `node src/server.js`)

### 4. Deployment Steps

1. Push промените към GitHub:
   ```bash
   git add backend/railway.json backend/nixpacks.toml
   git commit -m "Add Railway deployment configuration"
   git push origin main
   ```

2. Railway автоматично ще направи deploy на промените

3. След успешен deploy, виж:
   - **Logs** → Провери че сървърът стартира без грешки
   - **Deployments** → Вземи URL-а (например: `https://cp-audit-production.up.railway.app`)

### 5. Health Check

След deploy, тествай endpoints:

```bash
# Basic health
curl https://your-railway-url.up.railway.app/health

# Detailed health (провери Claude API, Blob token)
curl https://your-railway-url.up.railway.app/health/detailed
```

### 6. Troubleshooting

**Problem: "Missing environment variables"**
- Провери че са добавени всички env vars в Railway settings
- Server няма да стартира ако липсват CLAUDE_API_KEY или VERCEL_BLOB_TOKEN

**Problem: "Puppeteer failed to launch"**
- Chromium се инсталира автоматично чрез nixpacks.toml
- Провери PUPPETEER_EXECUTABLE_PATH е правилно настроена

**Problem: "Database connection failed"**
- SQLite файлът се създава автоматично при първи старт
- Persistent storage е enabled по подразбиране в Railway

**Problem: "Build failed"**
- Провери че Root Directory е `backend`
- Провери че railway.json и nixpacks.toml са в backend директория
- Виж Build Logs в Railway dashboard

### 7. Post-Deployment

1. Запиши Railway URL (ще ти трябва за Vercel frontend)
2. Тествай POST /api/audit/start endpoint
3. Провери че audit-ите се записват в database
4. Провери screenshots upload към Vercel Blob

### 8. Monitoring

Railway автоматично дава:
- CPU usage
- Memory usage
- Network traffic
- Deployment history
- Real-time logs

За да видиш error logs:
```bash
curl https://your-railway-url.up.railway.app/health/errors?limit=50
```

### 9. Domain (Optional)

След успешен deploy:
1. Railway → Settings → Networking
2. Generate Domain или Custom Domain
3. Update frontend NEXT_PUBLIC_API_URL

---

## Quick Deploy Checklist

- [ ] Root Directory зададена на `backend`
- [ ] CLAUDE_API_KEY добавена
- [ ] VERCEL_BLOB_TOKEN добавена
- [ ] railway.json съществува в backend/
- [ ] nixpacks.toml съществува в backend/
- [ ] Push към GitHub
- [ ] Deploy успешен
- [ ] /health endpoint работи
- [ ] /health/detailed показва всички checks като healthy
