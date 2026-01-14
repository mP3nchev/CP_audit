# Vercel Deployment Guide - Frontend

## Първоначална конфигурация

### 1. Import Project в Vercel

Когато импортваш от GitHub, попълни полетата както следва:

```
┌─────────────────────────────────────────────────────────┐
│ Framework Preset:    Next.js                            │
│                                                         │
│ Root Directory:      frontend                           │
│                     (ВАЖНО! Не оставяй празно!)        │
│                                                         │
│ Build Command:       npm run build                      │
│                     (или остави default)               │
│                                                         │
│ Output Directory:    .next                              │
│                     (или остави default)               │
│                                                         │
│ Install Command:     npm install                        │
│                     (или остави default)               │
└─────────────────────────────────────────────────────────┘
```

### 2. Environment Variables

**ВАЖНО:** Добави следните променливи преди Deploy:

#### Production Variables:
```bash
# Backend API URL (от Railway)
NEXT_PUBLIC_API_URL=https://your-railway-app.up.railway.app

# App Name
NEXT_PUBLIC_APP_NAME=GDPR Auditor
```

**Как да добавиш променливи:**
1. Vercel Dashboard → Project Settings → Environment Variables
2. Добави всяка променлива
3. Environment: Production, Preview, Development (избери Production)
4. Click "Add"

### 3. Build & Output Settings

За Next.js 14 с App Router:

```bash
Framework: Next.js
Node.js Version: 20.x (default)
Package Manager: npm
Build Command: cd frontend && npm run build
Output Directory: frontend/.next
Install Command: cd frontend && npm install
```

**ВАЖНО:** Vercel автоматично детектира Next.js проект, НО трябва да укажеш `Root Directory: frontend`

### 4. Deploy Steps

1. **Connect Repository:**
   - Влез в Vercel: https://vercel.com
   - New Project → Import Git Repository
   - Избери `mP3nchev/CP_audit`

2. **Configure Project:**
   - Project Name: `cp-audit-frontend` (или каквото искаш)
   - Framework Preset: **Next.js**
   - Root Directory: **frontend** ← НАЙ-ВАЖНОТО!
   - Остави Build/Install commands по подразбиране

3. **Add Environment Variables:**
   - Click "Environment Variables"
   - Add: `NEXT_PUBLIC_API_URL` = `https://your-railway-url.up.railway.app`
   - Add: `NEXT_PUBLIC_APP_NAME` = `GDPR Auditor`

4. **Deploy:**
   - Click "Deploy"
   - Wait 2-3 minutes за build
   - Vercel ще ти даде URL (например: `https://cp-audit-frontend.vercel.app`)

### 5. Post-Deployment Testing

След успешен deploy, тествай:

```bash
# Home page
https://your-vercel-app.vercel.app

# Health check (трябва да показва Backend status)
# Отвори браузъра и виж дали форма се зарежда правилно
```

### 6. Troubleshooting

**Problem: "Module not found" errors**
- Провери че Root Directory е `frontend`
- Vercel трябва да run `npm install` в frontend директория

**Problem: "Build failed - next not found"**
- Провери package.json в frontend има Next.js dependency
- Root Directory трябва да е `frontend`

**Problem: "API calls fail (CORS errors)"**
- Провери NEXT_PUBLIC_API_URL е правилен Railway URL
- Backend трябва да има CORS enabled (вече е настроен)
- Railway backend трябва да работи

**Problem: "Environment variables undefined"**
- Vercel environment variables трябва да започват с `NEXT_PUBLIC_`
- Редеплой след добавяне на променливи
- Провери в Vercel → Project Settings → Environment Variables

**Problem: "Page shows 'API disconnected'"**
- Това означава frontend не може да достигне backend
- Провери Railway backend е deployed и работи
- Провери NEXT_PUBLIC_API_URL е correct
- Тествай Railway health endpoint директно

### 7. Custom Domain (Optional)

След успешен deploy:
1. Vercel → Project Settings → Domains
2. Add Domain
3. Follow DNS configuration instructions

### 8. Automatic Deployments

Vercel автоматично ще deploy при всеки push към:
- **main branch** → Production deployment
- **други branches** → Preview deployments

### 9. Preview Deployments

При всеки Pull Request:
- Vercel създава Preview URL
- Можеш да тестваш промени преди merge
- Preview URLs са временни

---

## Quick Deploy Checklist

- [ ] Repository connected to Vercel
- [ ] Root Directory: `frontend` ✅
- [ ] Framework: Next.js selected
- [ ] NEXT_PUBLIC_API_URL добавена (Railway URL)
- [ ] NEXT_PUBLIC_APP_NAME добавена
- [ ] Build успешен (виж Vercel logs)
- [ ] Home page се зарежда
- [ ] API connection работи (виж console за errors)
- [ ] Форма се показва правилно
- [ ] Може да се submit audit request

---

## Integration Check

След deploy на backend И frontend:

1. **Backend check:**
   ```bash
   curl https://your-railway-url.up.railway.app/health
   ```

2. **Frontend check:**
   - Отвори `https://your-vercel-url.vercel.app`
   - Виж Network tab в DevTools
   - Трябва да видиш API call към Railway URL
   - Backend API indicator трябва да показва "Connected"

3. **Full flow test:**
   - Enter website URL
   - (Optional) Upload privacy policy
   - Click "Start GDPR Audit"
   - Провери че audit започва (loading state)
   - След 4-5 минути трябва да видиш report

---

## Environment URLs

След deployment ще имаш:

```
Frontend (Vercel): https://cp-audit-frontend.vercel.app
Backend (Railway): https://cp-audit-production.up.railway.app

API Integration:
Frontend calls → Backend endpoints
Example:
  POST https://cp-audit-production.up.railway.app/api/audit/start
```

Запиши двата URLs - ще ти трябват за testing и production use!
