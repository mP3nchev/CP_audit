# GDPR Audit Report v2 — Integration Plan

**Document Version:** 1.0
**Date:** February 8, 2026
**Author:** Claude (Senior Frontend Architect + Product Integration Lead)

---

## Executive Summary

This document outlines the integration strategy for the new premium GDPR audit report template (`compliance-audit-report.zip`) into the existing CP_audit system. The integration follows a **parallel, non-breaking approach** with a v2 preview route that preserves all existing functionality while delivering an executive-grade, print-optimized reporting experience.

---

## Current Architecture Analysis

### 1. Data Sources & Flow

**Database Schema (SQLite):**
```
audits
├── id (primary key)
├── audit_uid (unique identifier, e.g., "aud_9277b115724ebbe5")
├── website_url
├── status (processing/completed/failed/paused)
├── overall_score, score_grade
├── created_at, updated_at, completed_at

scan_results
├── audit_id (foreign key)
├── cookies_json (array of cookie objects)
├── network_requests_json (tracking requests)
├── tracking_before_consent (boolean)
├── banner_violations_json (NOYB checklist violations)
├── consent_mode_v2_status (JSON: version, compliance, issues)
├── compliance_score_json
├── request_categorization_json
├── timeline_json
├── consent_simulation_json (reject/accept scenarios)

policy_analyses
├── audit_id
├── policy_type ('privacy' or 'cookie')
├── analysis_result_json (criteria, scores, tiers)

cookie_comparisons
├── audit_id
├── declared_cookies_json
├── undeclared_cookies_json
├── mismatched_retention_json

risk_assessments
├── audit_id
├── risk_level, risk_min, risk_max
├── violations_json
```

**Data Flow:**
1. User initiates scan → `POST /api/audit/start`
2. `scanWebsite()` collects cookies, network requests, banner data
3. User uploads policy → `POST /api/audit/:id/privacy-policy`
4. Async Phase 3: risk assessment, cookie comparison, compliance scoring
5. Report generated → `GET /api/audit/:id/report` (Handlebars HTML)

### 2. Current Report Route

**Backend Route:**
- **Path:** `/api/audit/:audit_id/report`
- **Handler:** `backend/src/routes/audit.routes.js:710`
- **Generator:** `backend/src/generators/html-report-builder.js`
- **Template:** `backend/templates/gdpr-report-template.html` (Handlebars)
- **Process:**
  1. Fetch audit data via `gatherAuditData(auditUid)`
  2. Transform to template vars via `transformDataForTemplate()`
  3. Compile Handlebars template → HTML string
  4. Return as `text/html`

**Frontend Route:**
- **Path:** `/report/[id]/page.jsx`
- **Behavior:** Loads report in `<iframe src="/api/audit/{id}/report" />`
- **Polling:** Checks `/api/audit/:id/status` until `status === 'completed'`

### 3. Existing Types & Models

**No TypeScript:** Current codebase is JavaScript-only (Node.js + React JSX).

**Key Data Transformations:**
- `aggregateCriticalViolations()` → Combines banner + tracking + consent mode violations
- `transformDataForTemplate()` → Maps DB schema to Handlebars variables
- No formal interfaces/types defined

### 4. PDF Generation

**Current Approach:**
- Puppeteer used in `backend/src/scanners/website-scanner.js`
- `page.pdf()` called with A4 settings
- Not directly tied to report route (used for screenshots during scan)

**Template Approach:**
- Report route returns HTML directly (no PDF endpoint currently)
- Browsers can print via Ctrl+P / Cmd+P

---

## New Template Structure

### File Organization

```
compliance-audit-report.zip (427 KB, 92 files)
├── app/
│   ├── globals.css (print styles: @page A4, page-break rules)
│   ├── layout.tsx (Next.js root layout)
│   └── page.tsx (main report page)
├── components/
│   ├── report/
│   │   ├── cover-page.tsx
│   │   ├── executive-summary.tsx
│   │   ├── scope-methodology.tsx
│   │   ├── high-risk-finding.tsx
│   │   ├── medium-findings.tsx
│   │   ├── cookie-inventory.tsx
│   │   ├── compliance-matrix.tsx
│   │   ├── privacy-policy-analysis.tsx
│   │   ├── roadmap.tsx
│   │   ├── next-steps.tsx
│   │   ├── sidebar-nav.tsx
│   │   ├── severity-badge.tsx
│   │   └── report-section.tsx
│   ├── ui/ (shadcn components: accordion, alert, badge, etc.)
│   └── theme-provider.tsx
├── lib/
│   ├── report-data.ts (518 lines: sample data model)
│   └── utils.ts (cn() helper)
├── hooks/ (use-mobile, use-toast)
├── styles/
│   └── globals.css (Tailwind + print rules)
├── public/ (SVG placeholders)
└── config files (tsconfig, tailwind.config, package.json)
```

### Technology Stack

- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **UI Library:** shadcn/ui (Radix UI + Tailwind CSS)
- **Styling:** Tailwind CSS + CSS custom properties (`--cp-blue-100`, `--cp-error`, etc.)
- **Icons:** lucide-react

### Data Model (`lib/report-data.ts`)

**Key Sections:**
```typescript
export const reportData = {
  meta: {
    scanId, scanDate, targetUrl, userAgent, auditType, preparedFor, preparedBy
  },
  executive: {
    complianceStatus, topFindings[], businessImpact[], miniRoadmap
  },
  scope: {
    whatWeTested[], howWeTested[], limitations[]
  },
  finding1, finding2: {
    headline, severity, confidence, observation, legalContext,
    businessRisk, recommendation, effort, topEvidence[]
  },
  mediumFindings: [{
    title, severity, description, businessImpact, recommendation
  }],
  cookies: [{
    name, category, vendor, purpose, lifespan, declared
  }],
  consentChecklist: [{
    requirement, status, severity
  }],
  complianceMatrix: [{
    requirement, status, evidence, businessImpact, fix
  }],
  privacyPolicyAnalysis: {
    finalScore, finalTotal, tiers: [{
      id, name, severity, percentage, earnedPoints, maxPoints,
      criteria: [{ name, score, maxScore, status, explanation }]
    }]
  },
  humanAssisted: {
    afterReject, afterAccept, newAfterAccept, cookiesAfterAccept[]
  },
  riskBreakdown: [{
    category, percentage, severity, description
  }]
}
```

### Print/PDF Styling

**Approach (`app/globals.css:84-182`):**
```css
@media print {
  @page {
    size: A4;
    margin: 12mm 14mm;
  }

  html, body {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    font-size: 11px !important;
  }

  .no-print { display: none !important; }
  .print-full-width { max-width: 100% !important; }

  tr { page-break-inside: avoid; }
  .print-avoid-break { page-break-inside: avoid; }
  .print-break-before { page-break-before: always; }
}
```

**Features:**
- A4 page size with proper margins
- Exact color preservation for charts/badges
- Automatic page breaks for sections
- Tables avoid breaking mid-row
- Sidebar hidden on print

---

## Integration Strategy

### Constraints (Non-Negotiable)

✅ **NO breaking changes** to existing routes/APIs/auth/scan IDs
✅ **Buildable at each step** (no big-bang rewrite)
✅ **Preserve premium multi-component structure** (no flattening)
✅ **Fully dynamic** (no hardcoded domains, dates, counts, findings)
✅ **TypeScript-safe** where applicable
✅ **Follow existing repo conventions** (Tailwind, Next.js App Router)

### Phased Approach

#### **Phase 1: Foundation (v2 Preview Route)**

**Backend:**
1. Create new route: `GET /api/audit/:audit_id/report-v2`
   - Location: `backend/src/routes/audit.routes.js`
   - Handler: Return JSON (not HTML) with transformed data
   - Data adapter: Map DB schema → `reportData` structure
   - Parallel to existing `/report` route (no modifications)

**Frontend:**
1. Create new directory: `frontend/app/report-v2/[id]/`
2. Copy template components to: `frontend/app/components/report/`
3. Copy shadcn UI components to: `frontend/app/components/ui/`
4. Install dependencies: `pnpm add lucide-react class-variance-authority clsx tailwind-merge`
5. Update `tailwind.config.js` with template's custom colors
6. Merge print styles from template into `frontend/app/globals.css`

#### **Phase 2: Data Model Mapping**

**Create Canonical Adapter:**
```javascript
// frontend/lib/report-data-adapter.js
export function adaptScanDataToReportModel(apiResponse) {
  const { audit, scanResults, privacyAnalysis, cookieComparison, riskAssessment } = apiResponse;

  return {
    meta: {
      scanId: audit.audit_uid,
      scanDate: formatDate(audit.created_at),
      targetUrl: audit.website_url,
      // ... map all meta fields
    },
    executive: {
      complianceStatus: deriveComplianceStatus(audit.overall_score),
      topFindings: extractTopFindings(scanResults, riskAssessment),
      // ... map executive summary
    },
    // ... map all other sections
  };
}
```

**Mapping Table:**

| Template Field | Source Data | Transformation |
|----------------|-------------|----------------|
| `meta.scanId` | `audit.audit_uid` | Direct |
| `meta.scanDate` | `audit.created_at` | Format to "February 8, 2026" |
| `meta.targetUrl` | `audit.website_url` | Direct |
| `executive.complianceStatus` | `audit.overall_score` | Map: <30="Critical", 30-60="High Risk", etc. |
| `executive.topFindings` | `aggregateCriticalViolations()` | Take top 3 by severity |
| `finding1` (tracking) | `scanResults.tracking_before_consent` + `timeline_json` | Build finding object |
| `finding2` (banner) | `scanResults.banner_violations_json` | Find reject button violation |
| `mediumFindings` | Consent Mode, Policy Score, Undeclared Cookies | Build array |
| `cookies` | `scanResults.cookies_json` + `cookie_comparisons` | Merge declared status |
| `privacyPolicyAnalysis` | `policy_analyses.analysis_result_json` | Direct (already structured) |
| `humanAssisted` | `scanResults.consent_simulation_json` | Map reject/accept scenarios |

#### **Phase 3: Component Integration**

**Steps:**
1. Create page component: `frontend/app/report-v2/[id]/page.tsx`
2. Fetch data from `/api/audit/:id/report-v2`
3. Apply `adaptScanDataToReportModel()` transformation
4. Render template components with real data
5. Test each component in isolation (Storybook optional)

**Example Page Structure:**
```tsx
// frontend/app/report-v2/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adaptScanDataToReportModel } from '@/lib/report-data-adapter';
import { CoverPage } from '@/components/report/cover-page';
import { ExecutiveSummary } from '@/components/report/executive-summary';
// ... import all components

export default function ReportV2Page() {
  const params = useParams();
  const [reportData, setReportData] = useState(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    fetch(`${apiUrl}/api/audit/${params.id}/report-v2`)
      .then(res => res.json())
      .then(data => setReportData(adaptScanDataToReportModel(data)));
  }, [params.id]);

  if (!reportData) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-[var(--cp-blue-5)]">
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6 print-full-width">
        <div className="flex gap-6">
          <SidebarNav />
          <main className="flex-1 min-w-0 flex flex-col gap-6">
            <CoverPage meta={reportData.meta} />
            <ExecutiveSummary executive={reportData.executive} />
            {/* ... render all sections */}
          </main>
        </div>
      </div>
    </div>
  );
}
```

#### **Phase 4: Print Optimization**

**CSS Integration:**
1. Copy entire `@media print {}` block from template `app/globals.css`
2. Merge into `frontend/app/globals.css`
3. Test print preview in Chrome/Firefox
4. Adjust page breaks for long findings/tables

**Validation:**
- [ ] A4 page size detected
- [ ] Colors preserved (no grayscale)
- [ ] Sidebar hidden
- [ ] Tables don't break mid-row
- [ ] Each section starts cleanly
- [ ] Footer/header margins correct

#### **Phase 5: Testing & Rollout**

**Test Cases:**
1. Scan with all violations → verify all sections populated
2. Scan with no violations → verify "compliant" states render correctly
3. Scan with missing policy → verify "not checked" states
4. Long cookie list (50+ cookies) → verify pagination/print layout
5. Privacy policy with 0/100 score → verify tier sections render
6. Print to PDF → verify A4 layout, colors, page breaks

**Rollout Plan:**
1. Deploy v2 route behind feature flag (environment variable)
2. Test with 5 internal audits
3. Compare v1 vs v2 output side-by-side
4. Gather feedback on UX/layout
5. Enable v2 by default (keep v1 as fallback)
6. Monitor for 2 weeks before deprecating v1

---

## Critical Files & Locations

### Backend
- **Route Handler:** `backend/src/routes/audit.routes.js` (add new route at line ~810)
- **Data Adapter:** `backend/src/generators/report-data-adapter.js` (NEW FILE)
- **Existing Report Builder:** `backend/src/generators/html-report-builder.js` (DO NOT MODIFY)

### Frontend
- **New Page:** `frontend/app/report-v2/[id]/page.tsx` (NEW FILE)
- **Components:** `frontend/app/components/report/` (NEW DIRECTORY)
- **shadcn UI:** `frontend/app/components/ui/` (NEW DIRECTORY)
- **Data Adapter:** `frontend/lib/report-data-adapter.js` (NEW FILE)
- **Styles:** `frontend/app/globals.css` (MERGE print styles)
- **Tailwind Config:** `frontend/tailwind.config.js` (ADD custom colors)

### Database
- **No schema changes required**
- All data sources already exist in current tables

---

## Data Mapping Reference

### Top Findings Extraction Logic

```javascript
function extractTopFindings(scanResults, riskAssessment) {
  const findings = [];

  // Finding 1: Tracking Before Consent
  if (scanResults.tracking_before_consent) {
    const timelineData = JSON.parse(scanResults.timeline_json || '{}');
    const trackingCount = timelineData.violations?.length || 0;
    findings.push({
      title: "Tracking Before Consent",
      severity: "critical",
      summary: `${trackingCount} tracking requests detected before any user consent was obtained, including Google Tag Manager, Facebook Pixel, and LinkedIn.`
    });
  }

  // Finding 2: Missing Reject Button
  const bannerViolations = JSON.parse(scanResults.banner_violations_json || '[]');
  const rejectButtonViolation = bannerViolations.find(v =>
    v.id === 'reject_button' || v.description?.includes('Reject')
  );
  if (rejectButtonViolation) {
    findings.push({
      title: "Missing Reject Button",
      severity: "critical",
      summary: "Cookie banner lacks an equally prominent 'Reject All' button, making consent non-compliant under GDPR Article 7(4)."
    });
  }

  // Finding 3: Undeclared Cookies (if cookie comparison exists)
  const cookieComparison = db.prepare(`
    SELECT * FROM cookie_comparisons WHERE audit_id = ?
  `).get(scanResults.audit_id);

  if (cookieComparison) {
    const undeclared = JSON.parse(cookieComparison.undeclared_cookies_json || '[]');
    if (undeclared.length > 0) {
      findings.push({
        title: "Undeclared Cookie Inventory",
        severity: "high",
        summary: `${undeclared.length} cookies detected but 0 declared in cookie policy, creating a transparency gap under GDPR Article 13.`
      });
    }
  }

  return findings.slice(0, 3); // Top 3 only
}
```

### Privacy Policy Tier Mapping

```javascript
function mapPrivacyPolicyTiers(policyAnalysis) {
  const tiers = [
    { id: "tier1", name: "Tier 1 - Critical", severity: "critical", maxPoints: 40 },
    { id: "tier2", name: "Tier 2 - High", severity: "high", maxPoints: 25 },
    { id: "tier3", name: "Tier 3 - Medium", severity: "medium", maxPoints: 20 },
    { id: "tier4", name: "Tier 4 - Low", severity: "low", maxPoints: 15 }
  ];

  return tiers.map(tier => {
    const tierCriteria = policyAnalysis.criteria.filter(c => c.tier === tier.id);
    const earnedPoints = tierCriteria.reduce((sum, c) => sum + c.score, 0);
    const percentage = Math.round((earnedPoints / tier.maxPoints) * 100);

    return {
      ...tier,
      percentage,
      earnedPoints,
      criteria: tierCriteria.map(c => ({
        name: c.name,
        score: c.score,
        maxScore: c.weight,
        status: c.score >= c.weight ? "pass" : "fail",
        explanation: c.reasoning
      }))
    };
  });
}
```

---

## UX & Quality Standards

### Visual Consistency
- Use template's color system (`--cp-blue-100`, `--cp-error`, `--cp-warning`)
- Maintain shadcn/ui component styling (no custom overrides)
- Keep lucide-react icons consistent with template

### Responsive Design
- Desktop-first (report is B2B tool, not mobile-optimized)
- Sidebar collapsible on smaller screens (use shadcn sidebar component)
- Tables scroll horizontally on mobile (overflow-x-auto)

### Accessibility
- WCAG 2.1 AA minimum (contrast ratios, focus states)
- Semantic HTML (`<section>`, `<article>`, `<table>` with `<thead>`)
- ARIA labels for icons/badges

### Performance
- Lazy load heavy components (privacy policy tiers can be accordions)
- Optimize images (SVG logos, no heavy PNGs)
- Code split report components (Next.js automatic)

---

## Rollback Plan

If v2 integration fails or causes issues:

1. **Disable v2 route** via environment variable: `ENABLE_REPORT_V2=false`
2. **Redirect v2 requests** to v1: `app.get('/report-v2/:id', (req, res) => res.redirect(\`/report/\${req.params.id}\`))`
3. **Keep v1 route untouched** (no modifications during v2 development)
4. **Database unchanged** (no migrations, no new tables)

---

## Success Metrics

### Technical
- [ ] v2 route returns 200 OK with valid JSON
- [ ] All template components render without errors
- [ ] Print to PDF produces clean A4 output
- [ ] No console errors in browser
- [ ] Build completes without TypeScript errors

### Business
- [ ] Executive stakeholders prefer v2 visual design
- [ ] Print quality meets B2B professional standards
- [ ] All existing report data preserved (no information loss)
- [ ] Report generation time < 2 seconds (same as v1)

---

## Next Steps

1. ✅ Repository research complete
2. 🔄 Extract ZIP and review component dependencies
3. ⏳ Create backend `/report-v2` route with data adapter
4. ⏳ Set up frontend route with component integration
5. ⏳ Merge print styles and test PDF output
6. ⏳ End-to-end testing with real audit data
7. ⏳ Documentation update (README, API docs)

---

**Document Status:** Draft v1.0 — Ready for Implementation
**Next Review:** After Phase 1 completion (backend route + frontend scaffolding)
