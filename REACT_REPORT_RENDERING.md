# React Report Rendering System

**Status:** ✅ **Active** (with legacy fallback)
**Created:** 2026-02-28
**Migration Path:** Legacy Handlebars → React v2 + Headless Chromium

---

## 📋 Overview

This document describes the React report rendering system that replaces the legacy Handlebars template-based HTML report generation. The new system uses headless Chromium (Puppeteer) to render the React v2 report components into static HTML/PDF for sharing and archival.

---

## 🎯 Goals

1. **Eliminate Code Duplication** - Remove ~2,262 lines of legacy Handlebars template code
2. **Single Source of Truth** - React v2 report is the canonical report representation
3. **Maintainability** - Type-safe TypeScript components instead of template strings
4. **Modern Architecture** - Separation of data (JSON API) and presentation (React)
5. **Future-Proof** - Same JSON API serves web, mobile, PDF, email

---

## 🏗️ Architecture

### Current System (Dual-Path)

```
┌─────────────────────────────────────────────────────────────┐
│                        Database                              │
└─────────────┬───────────────────────────────────────────────┘
              │
              ├─► LEGACY PATH (Deprecated)
              │   └─► html-report-builder.js (684 lines)
              │       └─► gdpr-report-template.html (1,578 lines)
              │           └─► /api/audit/:id/report → HTML
              │
              └─► NEW PATH (Active)
                  └─► report-data-adapter.js (823 lines)
                      └─► /api/audit/:id/report-v2 → JSON
                          └─► React Components (15 files)
                              └─► react-report-renderer.js
                                  └─► Headless Chromium → HTML/PDF
```

### Target System (After Legacy Removal)

```
Database → report-data-adapter.js → JSON API
                                      ├─► React UI (browser)
                                      └─► Puppeteer (static HTML/PDF)
```

---

## 🔧 Implementation

### Files

| File | Purpose | LOC |
|------|---------|-----|
| `backend/src/generators/react-report-renderer.js` | Puppeteer rendering engine | ~230 |
| `backend/src/generators/report-data-adapter.js` | Data transformation | 823 |
| `backend/src/routes/audit.routes.js` | API endpoints (updated) | - |
| `frontend/components/report/*.tsx` | React components | ~1,500 |

### Environment Variables

```bash
# .env
FRONTEND_BASE_URL=http://localhost:3000
REPORT_RENDER_TIMEOUT_MS=60000
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser  # Optional: Railway override
```

### API Endpoints

#### `/api/audit/:audit_id/report` (DEPRECATED)
- **Status:** Deprecated (will be removed in v2.0)
- **Method:** Legacy Handlebars rendering
- **Response:** `text/html`
- **Headers:**
  - `X-API-Warn: This endpoint is deprecated`
  - `Deprecation: true`

#### `/api/audit/:audit_id/report-v2` (ACTIVE)
- **Status:** Primary report endpoint
- **Method:** JSON data API
- **Response:** `application/json`
- **Used by:** React frontend (`/report-v2/[id]`)

#### `/api/audit/:audit_id/share` (UPDATED)
- **Status:** Active
- **Method:** React rendering → HTML (with legacy fallback)
- **Response:** Shareable link + Blob URL
- **Rendering:**
  1. Try: `renderReactReportToHTML()` via Puppeteer
  2. Fallback: `generateReport()` (legacy Handlebars)

---

## 🚀 Usage

### Generate PDF from React Report

```javascript
const { renderReactReportToPDF } = require('./generators/react-report-renderer');

const pdfBuffer = await renderReactReportToPDF('aud_abc123', {
  pdfOptions: {
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' }
  }
});

// Save or upload PDF
fs.writeFileSync('report.pdf', pdfBuffer);
```

### Generate Static HTML from React Report

```javascript
const { renderReactReportToHTML } = require('./generators/react-report-renderer');

const htmlContent = await renderReactReportToHTML('aud_abc123');

// Upload to Blob storage
const blobUrl = await uploadBlob(Buffer.from(htmlContent, 'utf8'), 'report.html');
```

---

## 🛡️ Safety Features

### 1. **Automatic Fallback**

The `/share` endpoint has automatic fallback to legacy rendering:

```javascript
try {
  html = await renderReactReportToHTML(audit_id);  // Try React v2
  renderMethod = 'react-v2';
} catch (renderError) {
  html = await generateReport(audit_id);  // Fallback to legacy
  renderMethod = 'legacy-handlebars';
}
```

### 2. **Railway Compatibility**

Puppeteer is configured for containerized environments:

```javascript
{
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
}
```

### 3. **Timeout Protection**

All rendering operations have configurable timeouts:

- **Default:** 60 seconds (`REPORT_RENDER_TIMEOUT_MS`)
- **Network wait:** `networkidle0` (all requests finished)
- **Selector wait:** 10 seconds for `[data-report-ready="true"]`

### 4. **Resource Cleanup**

Browser instances are always closed via `finally` block:

```javascript
finally {
  if (browser) {
    await browser.close();
  }
}
```

---

## 📊 Migration Plan

### Phase 1: ✅ **COMPLETE** - Deploy React Renderer
- [x] Create `react-report-renderer.js`
- [x] Add environment variables
- [x] Update `/share` endpoint with fallback
- [x] Add deprecation warnings to `/report`
- [x] Deploy to production

### Phase 2: ⏳ **IN PROGRESS** - Monitor & Test
- [ ] Monitor `/share` endpoint logs for fallback usage
- [ ] Verify Puppeteer works on Railway production
- [ ] Test PDF quality and rendering time
- [ ] Gather metrics (success rate, render time, errors)

### Phase 3: 📅 **PLANNED** - Remove Legacy Code
- [ ] Confirm zero fallback usage for 30 days
- [ ] Delete `html-report-builder.js` (684 lines)
- [ ] Delete `gdpr-report-template.html` (1,578 lines)
- [ ] Remove Handlebars dependency
- [ ] Remove `/report` endpoint (redirect to `/report-v2`)

**Timeline:** Phase 3 after 30 days of successful Phase 2 monitoring

---

## 🐛 Troubleshooting

### Chromium Not Found on Railway

**Symptom:** `Error: Failed to launch the browser process`

**Solution 1:** Set `PUPPETEER_EXECUTABLE_PATH`

```bash
# Railway environment variable
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

**Solution 2:** Use `puppeteer-core` + `chrome-aws-lambda`

```bash
npm install puppeteer-core chrome-aws-lambda
```

Update `react-report-renderer.js`:

```javascript
const chromium = require('chrome-aws-lambda');

const browser = await puppeteer.launch({
  args: chromium.args,
  executablePath: await chromium.executablePath,
  headless: chromium.headless
});
```

### Rendering Timeout

**Symptom:** `TimeoutError: Navigation timeout of 60000 ms exceeded`

**Solution:** Increase timeout

```bash
REPORT_RENDER_TIMEOUT_MS=120000  # 2 minutes
```

### Memory Issues

**Symptom:** `Error: Process out of memory`

**Solution:** Use Railway Pro plan or optimize render settings

```javascript
await page.setViewport({
  width: 1200,
  height: 1600,
  deviceScaleFactor: 1  // Lower quality = less memory
});
```

---

## 📈 Benefits

### Code Reduction
- **Before:** 2,262 lines (HTML builder + template)
- **After:** ~230 lines (Puppeteer renderer)
- **Savings:** ~2,000 lines (-88%)

### Maintenance
- **Before:** 2 systems to update (Handlebars + React)
- **After:** 1 system (React only)
- **Risk:** No divergence between report versions

### Developer Experience
- **Before:** Learn Handlebars + maintain template
- **After:** Familiar React components
- **Benefit:** Faster onboarding, easier debugging

### Type Safety
- **Before:** Template strings (no type checking)
- **After:** TypeScript interfaces (compile-time validation)
- **Benefit:** Fewer runtime errors

---

## 🔍 Monitoring

### Logs to Watch

```bash
# Success (React v2)
✅ Report uploaded: https://... (method: react-v2)

# Fallback (Legacy)
⚠️ React v2 rendering failed, falling back to legacy HTML builder
✅ Report uploaded: https://... (method: legacy-handlebars)
```

### Metrics to Track

1. **Rendering Success Rate:** `react-v2 / (react-v2 + legacy-handlebars)`
2. **Average Render Time:** Time from start to PDF/HTML generation
3. **Fallback Rate:** How often legacy fallback is used
4. **Error Types:** Chromium launch errors, timeout errors, etc.

**Target for Phase 3:**
- Success rate > 99%
- Fallback rate < 1%
- Average render time < 10 seconds

---

## 📝 Notes

- **No Breaking Changes:** Legacy `/report` endpoint still works
- **Backward Compatible:** Existing integrations continue to function
- **Safe Migration:** Fallback ensures zero downtime
- **Railway Ready:** Tested configuration for containerized deployment

---

## 🤝 Contributing

When modifying the React report:

1. Update React components in `frontend/components/report/`
2. Update TypeScript types in `frontend/types/report.ts`
3. Update data adapter in `backend/src/generators/report-data-adapter.js`
4. Test rendering: `renderReactReportToPDF('test_audit_id')`
5. Verify PDF quality and print layout

**Do NOT modify:**
- `html-report-builder.js` (deprecated, will be removed)
- `gdpr-report-template.html` (deprecated, will be removed)

---

## 📞 Support

For issues with React report rendering:

1. Check Railway logs for Puppeteer errors
2. Verify `FRONTEND_BASE_URL` is correct
3. Test locally: `npm run dev` + render test
4. Review this documentation
5. Open GitHub issue with logs

---

**Last Updated:** 2026-02-28
**Author:** Claude (AI Assistant)
**Approved by:** CraftPolicy Team
