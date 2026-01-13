**TECHNICAL\_SPECS.md \- GDPR Auditor Technical Specifications**

## 📁 COMPLETE FILE STRUCTURE

gdpr-audit-tool/  
├── backend/  
│   ├── src/  
│   │   ├── server.js  
│   │   ├── scanners/  
│   │   │   ├── puppeteer-setup.js  
│   │   │   ├── cookie-extractor.js  
│   │   │   ├── network-monitor.js  
│   │   │   └── screenshot-capture.js  
│   │   ├── analyzers/  
│   │   │   ├── privacy-policy-analyzer.js  
│   │   │   ├── cookie-banner-checker.js  
│   │   │   ├── consent-mode-validator.js  
│   │   │   ├── cookie-policy-comparator.js  
│   │   │   ├── risk-assessor.js  
│   │   │   └── solution-generator.js  
│   │   ├── generators/  
│   │   │   ├── html-report-builder.js  
│   │   │   ├── chart-data-processor.js  
│   │   ├── integrations/  
│   │   │   ├── claude-api.js  
│   │   │   └── blob-storage.js  
│   │   ├── config  
│   │   │   └── [constants.js](http://constants.js)  
│   │   │   ├── gdpr-hub-precedents.csv  
│   │   ├── utils/  
│   │   │   ├── retry-handler.js  
│   │   │   ├── error-logger.js  
│   │   │   └── text-extractor.js  
│   │   ├── middleware/  
│   │   │   └── error-handler.js  
│   │   ├── database/  
│   │   │   ├── schema.sql  
│   │   │   └── db.js  
│   │   └── routes/  
│   │       ├── audit.routes.js  
│   │       └── health.routes.js  
│   ├── templates/  
│   │   └── report-template.html  
│   ├── prompts/  
│   │   └── privacy-policy-auditor-full.txt  
│   ├── logs/  
│   │   └── api-costs.json  
│   ├── tests/  
│   │   ├── scanner.test.js  
│   │   └── analyzer.test.js  
│   ├── .env.example  
│   ├── .gitignore  
│   ├── package.json  
│   └── README.md  
├── frontend/  
│   ├── app/  
│   │   ├── page.jsx  
│   │   ├── layout.jsx  
│   │   └── audit/  
│   │       └── \[id\]/  
│   │           └── page.jsx  
│   ├── components/  
│   │   ├── audit/  
│   │   │   ├── AuditForm.jsx  
│   │   │   ├── FileUpload.jsx  
│   │   │   └── LoadingState.jsx  
│   │   ├── report/  
│   │   │   ├── ReportViewer.jsx  
│   │   │   ├── RiskCard.jsx  
│   │   │   ├── CriteriaTable.jsx  
│   │   │   └── ChartSection.jsx  
│   │   └── ui/  
│   │       ├── Button.jsx  
│   │       ├── Card.jsx  
│   │       ├── Badge.jsx  
│   │       └── Input.jsx  
│   ├── lib/  
│   │   ├── api.js  
│   │   └── utils.js  
│   ├── styles/  
│   │   └── globals.css  
│   ├── public/  
│   │   └── favicon.ico  
│   ├── .env.local.example  
│   ├── .gitignore  
│   ├── package.json  
│   ├── tailwind.config.js  
│   ├── next.config.js  
│   └── README.md  
├── .gitignore  
├── TASK.md  
├── TECHNICAL\_SPECS.md  
└── README.md

## 🗄️ DATABASE SCHEMA

SQLite Schema (backend/src/database/schema.sql)  
sql-- Audits table  
CREATE TABLE IF NOT EXISTS audits (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    audit\_uid TEXT UNIQUE NOT NULL,  
    website\_url TEXT NOT NULL,  
    status TEXT NOT NULL DEFAULT 'pending',  
    error\_message TEXT,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    updated\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    completed\_at TIMESTAMP  
);

\-- Scan results table  
CREATE TABLE IF NOT EXISTS scan\_results (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    audit\_id INTEGER NOT NULL,  
    cookies\_json TEXT NOT NULL,  
    network\_requests\_json TEXT NOT NULL,  
    tracking\_before\_consent BOOLEAN DEFAULT 0,  
    screenshot\_full\_url TEXT,  
    screenshot\_banner\_url TEXT,  
    consent\_mode\_v2\_status TEXT,  
    banner\_violations\_json TEXT,  
    scan\_duration\_seconds INTEGER,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    FOREIGN KEY (audit\_id) REFERENCES audits(id) ON DELETE CASCADE  
);

\-- Policy analysis table  
CREATE TABLE IF NOT EXISTS policy\_analysis (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    audit\_id INTEGER NOT NULL,  
    policy\_type TEXT NOT NULL,  
    criteria\_scores\_json TEXT NOT NULL,  
    total\_score REAL,  
    percentage REAL,  
    category TEXT,  
    top\_recommendations\_json TEXT,  
    policy\_text TEXT,  
    analysis\_duration\_seconds INTEGER,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    FOREIGN KEY (audit\_id) REFERENCES audits(id) ON DELETE CASCADE  
);

\-- Cookie policy comparison table  
CREATE TABLE IF NOT EXISTS cookie\_comparisons (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    audit\_id INTEGER NOT NULL,  
    declared\_cookies\_json TEXT,  
    undeclared\_cookies\_json TEXT,  
    mismatched\_retention\_json TEXT,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    FOREIGN KEY (audit\_id) REFERENCES audits(id) ON DELETE CASCADE  
);

\-- Risk assessment table  
CREATE TABLE IF NOT EXISTS risk\_assessments (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    audit\_id INTEGER NOT NULL,  
    violations\_json TEXT NOT NULL,  
    total\_risk\_min INTEGER,  
    total\_risk\_max INTEGER,  
    risk\_level TEXT,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    FOREIGN KEY (audit\_id) REFERENCES audits(id) ON DELETE CASCADE  
);

\-- API cost tracking table  
CREATE TABLE IF NOT EXISTS api\_costs (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    audit\_id INTEGER,  
    operation TEXT NOT NULL,  
    input\_tokens INTEGER,  
    output\_tokens INTEGER,  
    cached\_tokens INTEGER DEFAULT 0,  
    cost\_usd REAL,  
    model TEXT,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    FOREIGN KEY (audit\_id) REFERENCES audits(id) ON DELETE CASCADE  
);

\-- Indexes for performance  
CREATE INDEX IF NOT EXISTS idx\_audits\_status ON audits(status);  
CREATE INDEX IF NOT EXISTS idx\_audits\_created ON audits(created\_at);  
CREATE INDEX IF NOT EXISTS idx\_api\_costs\_audit ON api\_costs(audit\_id);

\-- GDPR Precedents table  
CREATE TABLE IF NOT EXISTS gdpr\_precedents (  
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    dpa TEXT NOT NULL,  
    case\_number TEXT,  
    jurisdiction TEXT NOT NULL,  
    decision\_date TEXT,  
    relevant\_articles TEXT,  
    fine\_eur INTEGER,  
    sector TEXT,  
    summary TEXT  
);

CREATE INDEX idx\_precedents\_articles ON gdpr\_precedents(relevant\_articles);  
CREATE INDEX idx\_precedents\_jurisdiction ON gdpr\_precedents(jurisdiction);  
CREATE INDEX idx\_precedents\_fine ON gdpr\_precedents(fine\_eur);  
\`\`\`

ALTER TABLE audits ADD COLUMN overall\_score INTEGER;  
ALTER TABLE audits ADD COLUMN score\_grade TEXT;

## 🔧 CONFIGURATION FILES

noyb Violations (backend/src/config/noyb-violations.json)  
json{  
  "violations": \[  
    {  
      "id": "type\_a",  
      "name": "No Reject Button on First Layer",  
      "severity": "critical",  
      "description": "Cookie banner lacks equally prominent reject button alongside accept button",  
      "detection\_method": "DOM analysis for buttons with data-action='reject' or similar, compare styling with accept button",  
      "legal\_basis": "GDPR Art. 7(4) \- Consent must be freely given",  
      "edpb\_guidance": "Consent must be as easy to withdraw as to give",  
      "precedents": \[  
        {  
          "authority": "CNIL (France)",  
          "company": "Google",  
          "year": 2019,  
          "fine\_eur": 50000000,  
          "summary": "No easy way to refuse cookies"  
        },  
        {  
          "authority": "HBDI (Germany)",  
          "company": "H\&M",  
          "year": 2020,  
          "fine\_eur": 35000000,  
          "summary": "Inadequate consent mechanism"  
        }  
      \],  
      "check\_selectors": \[  
        "button\[data-action='reject'\]",  
        "button\[data-action='deny'\]",  
        "button:contains('Reject')",  
        "button:contains('Decline')"  
      \]  
    },  
    {  
      "id": "type\_b",  
      "name": "Pre-ticked Boxes",  
      "severity": "critical",  
      "description": "Checkboxes for non-essential cookies are pre-selected by default",  
      "detection\_method": "Find input\[type='checkbox'\]:checked before user interaction",  
      "legal\_basis": "GDPR Art. 4(11) \- Consent requires affirmative action",  
      "edpb\_guidance": "Pre-ticked boxes do not constitute valid consent",  
      "precedents": \[  
        {  
          "authority": "AEPD (Spain)",  
          "year": 2020,  
          "fine\_eur": 5000,  
          "summary": "Pre-ticked boxes for marketing cookies"  
        }  
      \],  
      "check\_selectors": \[  
        "input\[type='checkbox'\]:checked",  
        "input\[type='checkbox'\]\[checked\]"  
      \]  
    },  
    {  
      "id": "type\_c",  
      "name": "Deceptive Link Design",  
      "severity": "high",  
      "description": "Settings/Reject option displayed as small text link while Accept is prominent button",  
      "detection\_method": "Compare font-size, color, element type of settings link vs accept button",  
      "legal\_basis": "GDPR Art. 7(4) \- No undue influence on consent",  
      "edpb\_guidance": "All options must be presented with equal prominence",  
      "precedents": \[\],  
      "styling\_checks": {  
        "font\_size\_ratio\_max": 0.7,  
        "element\_type\_mismatch": true,  
        "visibility\_check": true  
      }  
    },  
    {  
      "id": "type\_d",  
      "name": "Deceptive Button Colours",  
      "severity": "high",  
      "description": "Accept button uses attractive color (green/blue) while Reject is grey/muted",  
      "detection\_method": "Analyze background-color CSS of accept vs reject buttons",  
      "legal\_basis": "GDPR Art. 7(4) \- Consent must be freely given",  
      "edpb\_guidance": "Visual design must not nudge users toward acceptance",  
      "precedents": \[\],  
      "color\_patterns": {  
        "accept\_attractive": \["\#00ff00", "\#00aa00", "\#0066ff", "\#007bff"\],  
        "reject\_muted": \["\#cccccc", "\#999999", "\#eeeeee", "\#f5f5f5"\]  
      }  
    },  
    {  
      "id": "type\_e",  
      "name": "Deceptive Button Contrast",  
      "severity": "high",  
      "description": "Accept button is larger, bolder, or more prominent than Reject",  
      "detection\_method": "Compare button dimensions, font-weight, padding",  
      "legal\_basis": "GDPR Art. 7(4) \- Consent must be freely given",  
      "edpb\_guidance": "Options must be presented equally",  
      "precedents": \[\],  
      "styling\_checks": {  
        "size\_ratio\_max": 1.3,  
        "font\_weight\_difference\_max": 200,  
        "padding\_ratio\_max": 1.5  
      }  
    },  
    {  
      "id": "type\_h",  
      "name": "Legitimate Interest Claimed for Ads",  
      "severity": "critical",  
      "description": "Banner claims 'legitimate interest' as legal basis for advertising/profiling",  
      "detection\_method": "Text search for 'legitimate interest' in banner, check if linked to ad categories",  
      "legal\_basis": "GDPR Art. 6(1)(f) \- Legitimate interest does not apply to intrusive ads",  
      "edpb\_guidance": "Legitimate interest cannot override need for consent in most advertising cases",  
      "precedents": \[  
        {  
          "authority": "EDPB",  
          "guidance": "Guidelines 2/2019 on Art. 6(1)(b)",  
          "summary": "Behavioral advertising requires consent, not legitimate interest"  
        }  
      \],  
      "text\_patterns": \[  
        "legitimate interest",  
        "законен интерес",  
        "berechtigtes interesse"  
      \]  
    },  
    {  
      "id": "type\_i",  
      "name": "Misclassified Essential Cookies",  
      "severity": "medium",  
      "description": "Tracking/analytics cookies incorrectly labeled as 'necessary' or 'essential'",  
      "detection\_method": "Check if cookies in 'necessary' category match known tracking patterns",  
      "legal\_basis": "ePrivacy Directive Art. 5(3) \- Only strictly necessary cookies exempt",  
      "edpb\_guidance": "Analytical cookies are not strictly necessary",  
      "precedents": \[\],  
      "essential\_patterns\_allowed": \[  
        "^(PHPSESSID|JSESSIONID)$",  
        "^csrftoken$",  
        "^\_session$",  
        "^cookieconsent\_"  
      \],  
      "tracking\_patterns\_forbidden": \[  
        "\_ga",  
        "\_gid",  
        "\_fbp",  
        "\_hjid"  
      \]  
    },  
    {  
      "id": "type\_k",  
      "name": "Difficult Consent Withdrawal",  
      "severity": "high",  
      "description": "No persistent mechanism to withdraw consent after it's given",  
      "detection\_method": "Look for hovering icon, footer link, or settings button on subsequent pages",  
      "legal\_basis": "GDPR Art. 7(3) \- Withdrawal must be as easy as giving consent",  
      "edpb\_guidance": "Users must have ongoing ability to change preferences",  
      "precedents": \[  
        {  
          "authority": "AEPD (Spain)",  
          "year": 2023,  
          "fine\_eur": 5000,  
          "summary": "No option to withdraw consent after initial acceptance"  
        }  
      \],  
      "required\_elements": \[  
        "Persistent icon/button on all pages",  
        "Footer link to cookie settings",  
        "Header menu with privacy options"  
      \]  
    }  
  \]  
}

## 🎨 DESIGN SYSTEM

Color Palette (frontend/styles/globals.css)  
css:root {  
  /\* Primary Brand Colors \*/  
  \--color-primary-900: rgb(30 58 138);     /\* \#1e3a8a \- Dark blue for headers \*/  
  \--color-primary-800: rgb(30 64 175);     /\* \#1e40af \- Medium blue for body text \*/  
  \--color-primary-600: rgb(37 99 235);     /\* \#2563eb \- Bright blue for links/CTAs \*/  
    
  /\* Accent Colors \*/  
  \--color-amber-800: rgb(146 64 14);       /\* \#92400e \- Amber for warnings \*/  
    
  /\* Status Colors \*/  
  \--color-critical: \#dc2626;    /\* Red \- Critical violations \*/  
  \--color-high: \#f59e0b;        /\* Orange \- High risk \*/  
  \--color-medium: \#eab308;      /\* Yellow \- Medium risk \*/  
  \--color-low: \#22c55e;         /\* Green \- Low risk / Compliant \*/  
  \--color-pass: \#10b981;        /\* Emerald \- Passed checks \*/  
    
  /\* Neutrals \*/  
  \--color-gray-50: \#f9fafb;  
  \--color-gray-100: \#f3f4f6;  
  \--color-gray-200: \#e5e7eb;  
  \--color-gray-300: \#d1d5db;  
  \--color-gray-400: \#9ca3af;  
  \--color-gray-500: \#6b7280;  
  \--color-gray-600: \#4b5563;  
  \--color-gray-700: \#374151;  
  \--color-gray-800: \#1f2937;  
  \--color-gray-900: \#111827;  
  \--color-black: \#000000;  
  \--color-white: \#ffffff;  
    
  /\* Backgrounds \*/  
  \--bg-page: var(--color-gray-50);  
  \--bg-card: var(--color-white);  
  \--bg-hover: var(--color-gray-100);  
    
  /\* Typography \*/  
  \--font-sans: 'Inter', system-ui, \-apple-system, sans-serif;  
  \--font-mono: 'Fira Code', 'Courier New', monospace;  
    
  /\* Spacing \*/  
  \--spacing-xs: 0.25rem;  
  \--spacing-sm: 0.5rem;  
  \--spacing-md: 1rem;  
  \--spacing-lg: 1.5rem;  
  \--spacing-xl: 2rem;  
  \--spacing-2xl: 3rem;  
    
  /\* Border Radius \*/  
  \--radius-sm: 0.25rem;  
  \--radius-md: 0.375rem;  
  \--radius-lg: 0.5rem;  
  \--radius-xl: 0.75rem;  
    
  /\* Shadows \*/  
  \--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);  
  \--shadow-md: 0 4px 6px \-1px rgba(0, 0, 0, 0.1);  
  \--shadow-lg: 0 10px 15px \-3px rgba(0, 0, 0, 0.1);  
}  
Tailwind Config (frontend/tailwind.config.js)  
javascriptmodule.exports \= {  
  content: \[  
    './app/\*\*/\*.{js,ts,jsx,tsx,mdx}',  
    './components/\*\*/\*.{js,ts,jsx,tsx,mdx}',  
  \],  
  theme: {  
    extend: {  
      colors: {  
        primary: {  
          900: 'rgb(30 58 138)',  
          800: 'rgb(30 64 175)',  
          600: 'rgb(37 99 235)',  
        },  
        amber: {  
          800: 'rgb(146 64 14)',  
        },  
        status: {  
          critical: '\#dc2626',  
          high: '\#f59e0b',  
          medium: '\#eab308',  
          low: '\#22c55e',  
          pass: '\#10b981',  
        },  
      },  
      fontFamily: {  
        sans: \['Inter', 'system-ui', 'sans-serif'\],  
        mono: \['Fira Code', 'monospace'\],  
      },  
    },  
  },  
  plugins: \[\],  
};

## 📊 REPORT SECTIONS DETAILED

\#\# 📄 HTML REPORT TEMPLATE \- READY TO USE

\*\*Location:\*\* report-template.html in GITHUB → 

\*\*Status:\*\* ✅ Production-ready HTML template created by v0.dev

\*\*Features:\*\*  
\- Standalone single-file HTML (self-contained)  
\- Mustache/Handlebars placeholder syntax ({{variable}})  
\- All 8 sections included with Chart.js visualizations  
\- Interactive tables with sorting and search filtering  
\- Tier dropdown system with percentages  
\- Timeline chart with clear legend  
\- Fully responsive design

\*\*Backend Integration:\*\*  
Use any templating engine (Mustache.js, Handlebars, or simple string replacement)  
to inject audit data into {{placeholders}}.

No conversion needed \- this template is ready for Phase 4 implementation.

## 🔐 ENVIRONMENT VARIABLES

Backend (.env)  
bash\# Server  
NODE\_ENV=development  
PORT=3001

\# Database  
DATABASE\_URL=./audits.db

\# Claude API  
CLAUDE\_API\_KEY=sk-ant-api03-xxxxx  
CLAUDE\_MODEL=claude-sonnet-4-20250514

\# Storage  
VERCEL\_BLOB\_TOKEN=vercel\_blob\_xxxxx

\# Rate Limiting  
RATE\_LIMIT\_WINDOW\_MS=3600000  
RATE\_LIMIT\_MAX\_REQUESTS=10

\# Puppeteer  
PUPPETEER\_TIMEOUT\_MS=120000  
PUPPETEER\_HEADLESS=true  
Frontend (.env.local)  
bashNEXT\_PUBLIC\_API\_URL=http://localhost:3001  
NEXT\_PUBLIC\_APP\_NAME=GDPR Auditor

##    \#\# 🔌 API ROUTES SPECIFICATION

\#\#\# Route 1: Start Audit

\*\*Endpoint:\*\* \`POST /api/audit/start\`

\*\*Request (multipart/form-data):\*\*  
\`\`\`javascript  
{  
  website\_url: "https://example.com",      // required, string  
  privacy\_policy: File,                     // required, PDF/Docx/HTML  
  cookie\_policy: File                       // required, PDF/Docx/HTML  
}  
\`\`\`

\*\*Response (200 OK):\*\*  
\`\`\`json  
{  
  "audit\_id": "aud\_abc123xyz",  
  "status": "processing",  
  "created\_at": "2026-01-13T10:00:00Z",  
  "estimated\_duration": "4-5 minutes"  
}  
\`\`\`

\*\*Response (400 Bad Request):\*\*  
\`\`\`json  
{  
  "error": "Invalid URL format",  
  "code": "E003"  
}  
\`\`\`

\---

\#\#\# Route 2: Get Audit Status (for auto-updates)

\*\*Endpoint:\*\* \`GET /api/audit/:audit\_id/status\`

\*\*Response (200 OK \- In Progress):\*\*  
\`\`\`json  
{  
  "audit\_id": "aud\_abc123xyz",  
  "status": "processing",  
  "progress": {  
    "current\_phase": "Phase 2: Privacy Policy Analysis",  
    "percentage": 45,  
    "steps\_completed": \[  
      "Scanner completed \- 23 cookies detected",  
      "Privacy Policy analyzed \- 520/730 score",  
      "Currently: Comparing Cookie Policy..."  
    \]  
  },  
  "started\_at": "2026-01-13T10:00:00Z",  
  "elapsed\_seconds": 180  
}  
\`\`\`

\*\*Response (200 OK \- Completed):\*\*  
\`\`\`json  
{  
  "audit\_id": "aud\_abc123xyz",  
  "status": "completed",  
  "report\_url": "/api/audit/aud\_abc123xyz/report",  
  "completed\_at": "2026-01-13T10:04:30Z",  
  "duration\_seconds": 270  
}  
\`\`\`

\*\*Response (200 OK \- Failed):\*\*  
\`\`\`json  
{  
  "audit\_id": "aud\_abc123xyz",  
  "status": "failed",  
  "error\_message": "Website timeout \- site took too long to load",  
  "error\_code": "E001",  
  "failed\_at": "2026-01-13T10:02:15Z"  
}  
\`\`\`

\---

\#\#\# Route 3: Get Report (opens in new tab)

\*\*Endpoint:\*\* \`GET /api/audit/:audit\_id/report\`

\*\*Response (200 OK):\*\*  
\- Content-Type: \`text/html\`  
\- Body: Complete standalone HTML report

\*\*Response (404 Not Found):\*\*  
\`\`\`json  
{  
  "error": "Audit not found or not completed",  
  "code": "E404"  
}  
\`\`\`

\---

\#\#\# Frontend Flow  
\`\`\`javascript  
// Step 1: Start audit  
const formData \= new FormData();  
formData.append('website\_url', 'https://example.com');  
formData.append('privacy\_policy', privacyFile);  
formData.append('cookie\_policy', cookieFile);

const response \= await fetch('/api/audit/start', {  
  method: 'POST',  
  body: formData  
});

const { audit\_id } \= await response.json();

// Step 2: Poll for status (every 5 seconds)  
const interval \= setInterval(async () \=\> {  
  const status \= await fetch(\`/api/audit/${audit\_id}/status\`);  
  const data \= await status.json();  
    
  // Update UI with progress  
  updateProgress(data.progress.percentage, data.progress.steps\_completed);  
    
  if (data.status \=== 'completed') {  
    clearInterval(interval);  
    // Open report in new tab  
    window.open(\`/api/audit/${audit\_id}/report\`, '\_blank');  
  }  
    
  if (data.status \=== 'failed') {  
    clearInterval(interval);  
    showError(data.error\_message);  
  }  
}, 5000);  
\`\`\`

\---

\#\#\# Progress Tracking in Database

Add to \`audits\` table:  
\`\`\`sql  
ALTER TABLE audits ADD COLUMN progress\_json TEXT;  
\`\`\`

\*\*Format:\*\*  
\`\`\`json  
{  
  "percentage": 45,  
  "current\_phase": "Privacy Policy Analysis",  
  "steps": \[  
    {"phase": "Scanner", "status": "completed", "message": "23 cookies detected"},  
    {"phase": "Privacy Analysis", "status": "in\_progress", "message": "Analyzing 37 criteria"},  
    {"phase": "Cookie Comparison", "status": "pending", "message": "Waiting..."},  
    {"phase": "Risk Assessment", "status": "pending", "message": "Waiting..."},  
    {"phase": "Report Generation", "status": "pending", "message": "Waiting..."}  
  \]  
}  
\`\`\`

\---

\#\#\# Implementation Notes

\*\*Synchronous Processing:\*\*  
\- Single audit runs start-to-finish in one request  
\- No queue system needed (only one audit at a time)  
\- Status updates written to database during processing

\*\*File Handling:\*\*  
\- Max file size: 10MB per file  
\- Allowed types: PDF (.pdf), Word (.docx), HTML (.html)  
\- Files stored temporarily in \`/tmp\`, deleted after processing

\*\*Error Recovery:\*\*  
\- Failed audits remain in database with error details  
\- User can retry with same files  
\- Logs saved to \`/backend/logs/errors.log\`

## ✅ VALIDATION RULES

Input Validation Schemas (Zod)  
Audit Request:  
javascriptconst AuditRequestSchema \= z.object({  
  website\_url: z.string()  
    .url({ message: "Must be a valid URL" })  
    .regex(/^https?:\\/\\//, { message: "Must start with http:// or https://" })  
    .max(2000, "URL too long"),  
    
  email: z.string()  
    .email({ message: "Invalid email format" })  
    .optional()  
});  
File Upload:  
javascriptconst FileUploadSchema \= z.object({  
  source\_type: z.enum(\['file', 'url'\]),  
    
  file: z.instanceof(File)  
    .refine(f \=\> f.size \<= 10 \* 1024 \* 1024, "File must be under 10MB")  
    .refine(  
      f \=\> \['.pdf', '.docx', '.html', '.htm'\].some(ext \=\> f.name.endsWith(ext)),  
      "File must be PDF, Docx, or HTML"  
    )  
    .optional(),  
    
  url: z.string().url().optional()  
}).refine(  
  data \=\> (data.source\_type \=== 'file' && data.file) || (data.source\_type \=== 'url' && data.url),  
  "Must provide either file or URL based on source\_type"  
);  
Business Logic Validation  
Cookie Categorization Rules:  
javascriptconst categorizeCookie \= (cookie) \=\> {  
  const { name, domain } \= cookie;  
    
  // Essential (exempt from consent)  
  if (/^(PHPSESSID|JSESSIONID|csrftoken|\_session)$/.test(name)) {  
    return 'essential';  
  }  
    
  // Analytics  
  if (/\_ga|\_gid|\_hjid|matomo/.test(name)) {  
    return 'analytics';  
  }  
    
  // Advertising  
  if (/\_fbp|\_gcl|doubleclick|\_\_gads/.test(name)) {  
    return 'advertising';  
  }  
    
  // Social  
  if (/facebook|twitter|linkedin|instagram/.test(domain)) {  
    return 'social\_media';  
  }  
    
  // Default: unknown  
  return 'unknown';  
};  
Tracking Domain Detection:  
javascriptconst isTrackingDomain \= (url) \=\> {  
  const trackingDomains \= require('./config/tracking-domains.json');  
  const hostname \= new URL(url).hostname;  
    
  return \[  
    ...trackingDomains.analytics,  
    ...trackingDomains.advertising,  
    ...trackingDomains.social\_media  
  \].some(domain \=\> hostname.includes(domain));  
};

## 🛠️ CLAUDE API INTEGRATION

Prompt Caching Setup  
Critical: Always use prompt caching to reduce costs by 90%  
javascriptasync function analyzePrivacyPolicy(policyText) {  
  const fullPrompt \= fs.readFileSync('./prompts/privacy-policy-auditor-full.txt', 'utf8');  
    
  const response \= await fetch('https://api.anthropic.com/v1/messages', {  
    method: 'POST',  
    headers: {  
      'x-api-key': process.env.CLAUDE\_API\_KEY,  
      'anthropic-version': '2023-06-01',  
      'content-type': 'application/json'  
    },  
    body: JSON.stringify({  
      model: 'claude-sonnet-4-20250514',  
      max\_tokens: 4096,  
      system: \[  
        {  
          type: "text",  
          text: fullPrompt,  // Full 47-page prompt  
          cache\_control: { type: "ephemeral" }  // ENABLE CACHING  
        }  
      \],  
      messages: \[  
        {  
          role: 'user',  
          content: \`PRIVACY POLICY TO ANALYZE:\\n\\n${policyText}\`  
        }  
      \]  
    })  
  });  
    
  const data \= await response.json();  
    
  // Log costs for monitoring  
  logAPICost({  
    input\_tokens: data.usage.input\_tokens,  
    output\_tokens: data.usage.output\_tokens,  
    cached\_tokens: data.usage.cache\_read\_input\_tokens || 0  
  });  
    
  return data.content\[0\].text;  
}  
Expected Response Format  
Claude should return JSON matching this structure:  
json{  
  "criteria": \[  
    {  
      "id": 1,  
      "name": "Controller Contact Details",  
      "tier": 1,  
      "weight": 5,  
      "score": 4,  
      "reasoning": "Privacy Policy includes company name, registered address, and email contact. Phone number is missing but optional.",  
      "recommendation": "Consider adding phone number for complete transparency."  
    }  
  \],  
  "total\_score": 520,  
  "max\_score": 730,  
  "percentage": 71.23,  
  "category": "Good",  
  "top\_recommendations": \[  
    "Add DPO contact information (Criterion 15)",  
    "Specify exact data retention periods (Criterion 26)",  
    "Clarify legal basis for each processing activity (Criterion 6)",  
    "Add information about automated decision-making (Criterion 29)",  
    "Include data breach notification procedure (Criterion 34)"  
  \]  
}

##   🍪 COOKIE POLICY COMPARISON LOGIC

\*\*File:\*\* \`/backend/src/analyzers/cookie-policy-comparator.js\`

\*\*Input:\*\*   
\- Cookie Policy document (PDF/HTML/Docx)   
\- Detected cookies from scanner

\*\*Process:\*\*  
1\. Extract cookie list from Cookie Policy via Claude API  
2\. Categorize detected cookies via Claude API    
3\. Match declared vs detected by name/domain  
4\. Identify: undeclared cookies, missing cookies, mismatched purposes

\*\*Claude API Prompt:\*\*  
"Extract all cookies mentioned in this Cookie Policy. Return JSON array with name, domain, category, purpose for each."

\*\*Output to database:\*\*  
\- \`declared\_cookies\_json\` \- cookies from Policy  
\- \`undeclared\_cookies\_json\` \- detected but not in Policy  
\- \`mismatched\_retention\_json\` \- (optional \- skip for MVP)

## 📦 PACKAGE.JSON EXAMPLES

Backend  
json{  
  "name": "gdpr-auditor-backend",  
  "version": "1.0.0",  
  "main": "src/server.js",  
  "scripts": {  
    "start": "node src/server.js",  
    "dev": "nodemon src/server.js"  
  },  
  "dependencies": {  
    "express": "^4.18.2",  
    "cors": "^2.8.5",  
    "dotenv": "^16.3.1",  
    "puppeteer": "^21.0.0",  
    "better-sqlite3": "^9.0.0",  
    "mammoth": "^1.6.0",  
    "pdf-parse": "^1.1.1",  
    "cheerio": "^1.0.0-rc.12",  
    "multer": "^1.4.5-lts.1",  
    "@vercel/blob": "^0.15.0",  
  },  
  "devDependencies": {  
    "nodemon": "^3.0.1"  
  }  
}  
Frontend  
json{  
  "name": "gdpr-auditor-frontend",  
  "version": "1.0.0",  
  "scripts": {  
    "dev": "next dev",  
    "build": "next build",  
    "start": "next start"  
  },  
  "dependencies": {  
    "react": "^18.2.0",  
    "react-dom": "^18.2.0",  
    "next": "^14.0.0",  
    "chart.js": "^4.4.0",  
    "react-chartjs-2": "^5.2.0",  
    "react-hook-form": "^7.48.0",  
    "zod": "^3.22.0",  
    "@hookform/resolvers": "^3.3.0"  
  },  
  "devDependencies": {  
    "tailwindcss": "^3.3.5",  
    "autoprefixer": "^10.4.16",  
    "postcss": "^8.4.31"  
  }  
}

## 🔍 ERROR CODES

HTTP Status Codes

200 \- Success  
400 \- Invalid input (validation failed)  
404 \- Audit not found  
429 \- Rate limit exceeded  
500 \- Internal server error  
503 \- Service unavailable (Puppeteer timeout)

Custom Error Codes  
javascriptconst ERROR\_CODES \= {  
  // Scanning errors  
  SCAN\_TIMEOUT: { code: 'E001', message: 'Website took too long to load' },  
  SCAN\_FAILED: { code: 'E002', message: 'Unable to access website' },  
  INVALID\_URL: { code: 'E003', message: 'Invalid or malformed URL' },  
    
  // API errors  
  CLAUDE\_TIMEOUT: { code: 'E101', message: 'Claude API request timed out' },  
  CLAUDE\_RATE\_LIMIT: { code: 'E102', message: 'Claude API rate limit reached' },  
  INVALID\_API\_KEY: { code: 'E103', message: 'Invalid Claude API key' },  
    
  // File errors  
  FILE\_TOO\_LARGE: { code: 'E201', message: 'File exceeds 10MB limit' },  
  INVALID\_FILE\_TYPE: { code: 'E202', message: 'Unsupported file format' },  
  TEXT\_EXTRACTION\_FAILED: { code: 'E203', message: 'Could not extract text from file' },  
    
  // Database errors  
  DB\_CONNECTION\_FAILED: { code: 'E301', message: 'Database connection failed' },  
  DB\_WRITE\_FAILED: { code: 'E302', message: 'Failed to save audit results' },  
    
  // Storage errors  
  BLOB\_UPLOAD\_FAILED: { code: 'E401', message: 'Failed to upload screenshot' },  
    
  // Validation errors  
  MISSING\_CRITERIA: { code: 'E501', message: 'Claude response missing required criteria' }  
};

## 📖 EXAMPLE DATA STRUCTURES

Audit Object (SQLite)  
json{  
  "id": 123,  
  "audit\_uid": "aud\_abc123xyz",  
  "website\_url": "https://example.com",  
  "status": "completed",  
  "created\_at": "2026-01-13T10:00:00Z",  
  "updated\_at": "2026-01-13T10:04:30Z",  
  "completed\_at": "2026-01-13T10:04:30Z",  
  "error\_message": null  
}  
Scan Results Object  
json{  
  "cookies": \[  
    {  
      "name": "\_ga",  
      "value": "GA1.2.123456789.1234567890",  
      "domain": ".example.com",  
      "path": "/",  
      "expires": 1735689600,  
      "expiresFormatted": "2026-12-31T23:59:59Z",  
      "size": 48,  
      "httpOnly": false,  
      "secure": true,  
      "sameSite": "Lax",  
      "type": "third-party",  
      "category": "analytics",  
      "purpose": "Google Analytics tracking",  
      "setBeforeConsent": true  
    }  
  \],  
  "networkRequests": \[  
    {  
      "url": "https://www.google-analytics.com/collect",  
      "method": "POST",  
      "timestamp": 0.234,  
      "beforeConsent": true,  
      "requestHeaders": { "User-Agent": "..." },  
      "responseStatus": 200,  
      "resourceType": "xhr",  
      "initiator": "google-tag-manager"  
    }  
  \],  
  "trackingBeforeConsent": true,  
  "trackingBeforeConsentCount": 12,  
  "screenshots": {  
    "fullPage": "https://blob.vercel-storage.com/.../full-page.png",  
    "banner": "https://blob.vercel-storage.com/.../cookie-banner.png"  
  },  
  "consentModeV2": {  
    "detected": true,  
    "configured": false,  
    "defaultSettings": {  
      "ad\_storage": "denied",  
      "analytics\_storage": "granted"  
    },  
    "compliant": false  
  },  
  "bannerViolations": \[  
    {  
      "id": "type\_a",  
      "name": "No Reject Button on First Layer",  
      "detected": true,  
      "severity": "critical"  
    }  
  \],  
  "scanDuration": 45.2  
}

## 🎯 PUPPETEER CONFIGURATION

Launch Options  
javascriptconst browser \= await puppeteer.launch({  
  headless: true,  
  args: \[  
    '--no-sandbox',  
    '--disable-setuid-sandbox',  
    '--disable-dev-shm-usage',  
    '--disable-gpu',  
    '--window-size=1920,1080'  
  \],  
  defaultViewport: {  
    width: 1920,  
    height: 1080  
  }  
});  
Page Configuration  
javascriptawait page.setUserAgent('Mozilla/5.0 (GDPR-Auditor-Bot/1.0) Chrome/120.0.0.0');  
await page.setExtraHTTPHeaders({  
  'Accept-Language': 'en-US,en;q=0.9'  
});

// Listen to network requests  
await page.setRequestInterception(true);  
page.on('request', request \=\> {  
  // Log or modify requests  
  request.continue();  
});

// Set timeout  
page.setDefaultNavigationTimeout(120000); // 2 minutes

This completes the TECHNICAL\_SPECS.md file. All configurations, data structures, and specifications are now centralized and ready for Claude Code to reference during development.

## 🔧 SOLUTION GENERATOR

\*\*File:\*\* \`/backend/src/analyzers/solution-generator.js\`

\*\*Input Data (from database):\*\*  
\- \`scan\_results\` \- cookies, tracking violations, banner issues  
\- \`policy\_analysis\` \- 37 criteria scores, failed criteria  
\- \`cookie\_comparisons\` \- undeclared cookies  
\- \`noyb violations\` \- 8-point checklist failures

\*\*Process:\*\*  
1\. Aggregate all detected problems into single context  
2\. Send to Claude API with strict formatting instructions  
3\. Return prioritized action items (top 5-10)

\*\*Claude API Prompt Structure:\*\*  
\`\`\`  
Audit findings:  
\- Scanner: {{tracking\_before\_consent}}, {{banner\_violations}}  
\- Privacy Policy: {{failed\_criteria}}  
\- Cookie Policy: {{undeclared\_cookies}}  
\- noyb: {{violations}}

Generate actionable solutions. STRICT FORMAT:

Title: \[Action Title \- max 6 words\]  
Problem: \[One sentence describing the issue\]  
Action: \[1-2 sentences with specific steps\]

Example:  
Title: Update Privacy Policy \- Legal Basis  
Problem: Your privacy policy doesn't clearly identify the legal basis for each processing activity under GDPR Article 6\.  
Action: For each data processing activity, explicitly state which legal basis applies: consent (6.1.a), contract (6.1.b), legal obligation (6.1.c), vital interests (6.1.d), public task (6.1.e), or legitimate interest (6.1.f).

Keep each solution under 100 words total. Be specific and actionable.  
\`\`\`

\*\*Output Format:\*\*  
\`\`\`json  
{  
  "solutions": \[  
    {  
      "title": "Update Privacy Policy \- Legal Basis",  
      "problem": "Your privacy policy doesn't clearly identify...",  
      "action": "For each data processing activity, explicitly state...",  
      "priority": "critical"  
    }  
  \]  
}  
\`\`\`

\*\*Cost:\*\* \~$0.03-0.05 per audit

## \#\# 💰 RISK CALCULATION WITH GDPR HUB PRECEDENTS

\*\*Data Source:\*\* 1500+ real DPA decisions from GDPR Hub

\*\*Process:\*\*  
1\. Map violations → GDPR articles (Type A → Art. 7(4), 5.3 ePD)  
2\. SQL query: filter by articles \+ jurisdiction \+ date \>2022  
3\. Statistical calculation: P25, P50, P75 from matched fines  
4\. Apply multipliers (aggravating/mitigating factors)  
5\. Revenue cap: MIN(calculated, 0.5% turnover)

\*\*Output:\*\*  
\`\`\`json  
{  
  "risk\_min": 12000,  
  "risk\_max": 65000,  
  "risk\_level": "High",  
  "cited\_precedents": \[  
    {"case": "AEPD PS/00586/2022", "fine": 50000}  
  \],  
  "matched\_count": 8  
}  
\`\`\`

## \#\# 📊 OVERALL COMPLIANCE SCORE (1-100)

\#\#\# Component Weights:

\*\*Privacy Policy Audit \- 35%\*\*  
\- Input: criteria\_scores total (e.g., 520/730 \= 71.2%)  
\- Contribution: 35 × (score/730)

\*\*Cookie Banner Compliance \- 30%\*\*  
\- Input: noyb violations passed (e.g., 6/8 \= 75%)  
\- Critical violations (Type A, D) count double  
\- Contribution: 30 × (passed/total)

\*\*Technical Implementation \- 20%\*\*  
\- Tracking before consent: No \= 100%, Yes \= 0%  
\- Consent Mode V2: Configured \= 100%, Missing \= 0%  
\- Average both → Contribution: 20 × average

\*\*Cookie Policy Accuracy \- 15%\*\*  
\- Formula: (Correctly declared / Total detected) × 100  
\- Contribution: 15 × match\_rate

\#\#\# Critical Violation Caps:  
\`\`\`javascript  
if (tracking\_before\_consent) score \= MIN(score, 55);  
if (no\_consent\_mechanism) score \= MIN(score, 50);  
if (both\_violations) score \= MIN(score, 40);  
\`\`\`

\#\#\# Score Bands:

\- 90-100: Excellent (A) \- Full compliance  
\- 75-89: Good (B) \- Minor issues  
\- 60-74: Fair (C) \- Moderate issues  
\- 40-59: Poor (D) \- Significant violations  
\- 0-39: Critical (F) \- Severe violations

\#\#\# Output Format:  
\`\`\`json  
{  
  "overall\_score": 78,  
  "grade": "Good",  
  "components": {  
    "privacy\_policy": {"score": 71.2, "contribution": 24.9},  
    "cookie\_banner": {"score": 75, "contribution": 22.5},  
    "technical": {"score": 100, "contribution": 20.0},  
    "cookie\_policy": {"score": 85, "contribution": 12.8}  
  },  
  "critical\_cap\_applied": false  
}  
\`\`\`

##     ☁️ VERCEL BLOB STORAGE

☁️ VERCEL BLOB STORAGE CONFIGURATION \#\#\# Purpose Upload and store screenshots (full page \+ cookie banner) with public URLs. 

**\*\*Usage Example:\*\*** \`\`\`javascript import { put } from '@vercel/blob'; async function uploadScreenshot(buffer, filename) { const { url } \= await put(filename, buffer, { access: 'public', token: process.env.BLOB\_READ\_WRITE\_TOKEN }); return url; } \`\`\` \#\#\# Configuration \- **\*\*Default size limit:\*\*** 10MB (sufficient for screenshots) \- **\*\*Retry logic:\*\*** 3 attempts with exponential backoff (500ms, 1s, 2s) \- **\*\*Access:\*\*** Public URLs (no authentication required for viewing) \- **\*\*Naming:\*\*** \`audit\_{uid}\_full.png\`, \`audit\_{uid}\_banner.png\` \#\#\# Error Handling \`\`\`javascript *// In blob-storage.js* async function uploadWithRetry(file, filename, attempts \= 3) { for (let i \= 0; i \< attempts; i\++) { try { return await put(filename, file, { access: 'public' }); } catch (error) { if (i \=== attempts \- 1) throw error; await delay(500 \* Math.pow(2, i)); } } } \`\`\` \#\#\# No Additional Configuration Needed Vercel Blob works out-of-box with just the token. No size limits, rate limits, or bucket configuration required for MVP. \`\`\`\`

## \#\# 🔍 TRACKING BEFORE CONSENT DETECTION

\#\#\# Objective  
Detect persistent identifier creation/usage before any user interaction, in compliance with GDPR Article 5(3) and ePrivacy Directive.

\#\#\# Legal Basis  
Tracking \= creation or use of persistent identifiers before valid consent. Consent cannot exist without user action.

\#\#\# Three-Step Detection Logic

\#\#\#\# Step 1: Define "Before Consent"  
**\*\*Rule:\*\*** Everything that happens before first user interaction

\`\`\`javascript

// Inject BEFORE page navigation (evaluateOnNewDocument) let firstUserActionAt \= null; window.\_\_trackingData \= { cookieWrites: \[\], lsWrites: \[\], idbWrites: \[\] };

\['click', 'keydown', 'touchstart'\].forEach(evt \=\> { window.addEventListener(evt, () \=\> { if (\!firstUserActionAt) { firstUserActionAt \= Date.now(); } }, { once: true, capture: true }); });

\#\#\#\# Step 2: Intercept Persistent Storage Writes

\*\*Cookie Interception:\*\*

\`\`\`javascript

const originalCookie \= Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

Object.defineProperty(document, 'cookie', { set(value) { window.\_\_trackingData.cookieWrites.push({ value, timestamp: Date.now() }); originalCookie.set.call(document, value); }, get() { return originalCookie.get.call(document); } });

\*\*localStorage Interception:\*\*

\`\`\`javascript

const originalSetItem \= localStorage.setItem;

localStorage.setItem \= function(key, value) { window.\_\_trackingData.lsWrites.push({ key, value, timestamp: Date.now() }); return originalSetItem.apply(this, arguments); };

\*\*IndexedDB Interception:\*\*

\`\`\`javascript

const originalOpen \= indexedDB.open;

indexedDB.open \= function(name) { window.\_\_trackingData.idbWrites.push({ name, timestamp: Date.now() }); return originalOpen.apply(this, arguments); };

\#\#\#\# Step 3: Classify as Tracking

\*\*Three Criteria (ALL must be true):\*\*

1\. \*\*Persistence Check:\*\*  
   \- Cookie: has \`expires\` or \`max-age\` attribute  
   \- localStorage/IndexedDB: always persistent

2\. \*\*Identifier Check (Entropy):\*\*

\`\`\`javascript

function looksLikeIdentifier(value) { return typeof value \=== 'string' && value.length \>= 8 && /\[a-z\]/i.test(value) // contains letters && /\\d/.test(value); // contains digits }

3\. \*\*Timing Check:\*\*  
   \- \`write.timestamp \< firstUserActionAt\`

\*\*Classification Logic:\*\*

\`\`\`javascript

IF (isPersistent(write) AND looksLikeIdentifier(write.value) AND write.timestamp \< firstUserActionAt) THEN trackingBeforeConsent \= TRUE

\#\#\# False Positive Prevention

❌ \*\*Language cookie\*\* (\`"en"\`, \`"bg"\`) → Fails entropy check    
❌ \*\*Feature flags\*\* (\`"enabled"\`, \`"true"\`) → Fails entropy check    
❌ \*\*Session cookies\*\* (no expires) → Fails persistence check    
❌ \*\*Post-interaction writes\*\* → Fails timing check

\#\#\# Implementation File

\*\*Location:\*\* \`/backend/src/scanners/tracking-detector.js\`

\*\*Integration in Puppeteer:\*\*

\`\`\`javascript

// In puppeteer-setup.js, BEFORE page.goto() await page.evaluateOnNewDocument(() \=\> { // Paste all interception code here });

// After page load \+ wait const trackingData \= await page.evaluate(() \=\> { return { firstInteraction: window.firstUserActionAt, writes: window.\_\_trackingData }; });

// Analyze const violations \= analyzeTracking(trackingData);

\#\#\# Output Format

\`\`\`json

{ "trackingBeforeConsent": true, "violationCount": 3, "identifiedTrackers": \[ { "type": "cookie", "name": "\_ga", "value": "GA1.2.1234567890.1234567890", "timestamp": 234, "persistent": true, "isIdentifier": true, "beforeConsent": true } \] }

\#\#\# Legal Justification Statement  
\*"We detect tracking based on the creation of persistent identifiers prior to any user interaction, which is incompatible with GDPR Art. 5(3) ePrivacy Directive."\*

**📋 Готови секции за TECHNICAL\_SPECS.md**

---

\#\# 🔍 TRACKING BEFORE CONSENT DETECTION

\#\#\# Objective

Detect persistent identifier creation/usage before any user interaction, in compliance with GDPR Article 5(3) and ePrivacy Directive.

\#\#\# Legal Basis

Tracking \= creation or use of persistent identifiers before valid consent. Consent cannot exist without user action.

\#\#\# Three-Step Detection Logic

\#\#\#\# Step 1: Define "Before Consent"

**\*\*Rule:\*\*** Everything that happens before first user interaction

\`\`\`\`javascript

*// Inject BEFORE page navigation (evaluateOnNewDocument)*

let firstUserActionAt \= null;

window.\_\_trackingData \= {

  cookieWrites: \[\],

  lsWrites: \[\],

  idbWrites: \[\]

};

\['click', 'keydown', 'touchstart'\].forEach(evt \=\> {

  window.addEventListener(evt, () \=\> {

    if (\!firstUserActionAt) {

      firstUserActionAt \= Date.now();

    }

  }, { once: true, capture: true });

});

\`\`\`\`

\#\#\#\# Step 2: Intercept Persistent Storage Writes

\*\*Cookie Interception:\*\*

\`\`\`\`javascript

const originalCookie \= Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

Object.defineProperty(document, 'cookie', {

  set(value) {

    window.\_\_trackingData.cookieWrites.push({

      value,

      timestamp: Date.now()

    });

    originalCookie.set.call(document, value);

  },

  get() {

    return originalCookie.get.call(document);

  }

});

\`\`\`\`

\*\*localStorage Interception:\*\*

\`\`\`\`javascript

const originalSetItem \= localStorage.setItem;

localStorage.setItem \= function(key, value) {

  window.\_\_trackingData.lsWrites.push({

    key,

    value,

    timestamp: Date.now()

  });

  return originalSetItem.apply(this, arguments);

};

\`\`\`\`

\*\*IndexedDB Interception:\*\*

\`\`\`\`javascript

const originalOpen \= indexedDB.open;

indexedDB.open \= function(name) {

  window.\_\_trackingData.idbWrites.push({

    name,

    timestamp: Date.now()

  });

  return originalOpen.apply(this, arguments);

};

\`\`\`\`

\#\#\#\# Step 3: Classify as Tracking

\*\*Three Criteria (ALL must be true):\*\*

1\. \*\*Persistence Check:\*\*

   \- Cookie: has \`expires\` or \`max-age\` attribute

   \- localStorage/IndexedDB: always persistent

2\. \*\*Identifier Check (Entropy):\*\*

\`\`\`\`javascript

function looksLikeIdentifier(value) {

  return typeof value \=== 'string'

    && value.length \>= 8

    && /\[a-z\]/i.test(value)  *// contains letters*

    && /\\d/.test(value);      *// contains digits*

}

\`\`\`\`

3\. \*\*Timing Check:\*\*

   \- \`write.timestamp \< firstUserActionAt\`

\*\*Classification Logic:\*\*

\`\`\`\`javascript

IF (isPersistent(write) 

    AND looksLikeIdentifier(write.value) 

    AND write.timestamp \< firstUserActionAt)

THEN

  trackingBeforeConsent \= TRUE

\`\`\`\`

\#\#\# False Positive Prevention

❌ \*\*Language cookie\*\* (\`"en"\`, \`"bg"\`) → Fails entropy check  

❌ \*\*Feature flags\*\* (\`"enabled"\`, \`"true"\`) → Fails entropy check  

❌ \*\*Session cookies\*\* (no expires) → Fails persistence check  

❌ \*\*Post\-interaction writes\*\* → Fails timing check

\#\#\# Implementation File

\*\*Location:\*\* \`/backend/src/scanners/tracking-detector.js\`

\*\*Integration in Puppeteer:\*\*

\`\`\`\`javascript

*// In puppeteer-setup.js, BEFORE page.goto()*

await page.evaluateOnNewDocument(() \=\> {

  *// Paste all interception code here*

});

*// After page load \+ wait*

const trackingData \= await page.evaluate(() \=\> {

  return {

    firstInteraction: window.firstUserActionAt,

    writes: window.\_\_trackingData

  };

});

*// Analyze*

const violations \= analyzeTracking(trackingData);

\`\`\`\`

\#\#\# Output Format

\`\`\`\`json

{

  "trackingBeforeConsent": true,

  "violationCount": 3,

  "identifiedTrackers": \[

    {

      "type": "cookie",

      "name": "\_ga",

      "value": "GA1.2.1234567890.1234567890",

      "timestamp": 234,

      "persistent": true,

      "isIdentifier": true,

      "beforeConsent": true

    }

  \]

}

\`\`\`\`

\#\#\# Legal Justification Statement

\*"We detect tracking based on the creation of persistent identifiers prior to any user interaction, which is incompatible with GDPR Art. 5(3) ePrivacy Directive."\*

## \#\# 🔐 GOOGLE CONSENT MODE V2 DETECTION

\#\#\# Objective

Detect if website uses Google Consent Mode V2 and validate proper configuration.

\#\#\# What is Consent Mode V2?

Google's framework for managing consent signals to Google tags (Analytics, Ads). V2 adds two new parameters required from March 2024 for EEA traffic.

\#\#\# Detection Method

\#\#\#\# Step 1: Hook gtag() Calls BEFORE Page Load

\`\`\`javascript

*// In evaluateOnNewDocument (BEFORE navigation)*

await page.evaluateOnNewDocument(() \=\> {

  window.\_\_gtagCalls \= \[\];

  window.\_\_consentMode \= {

    detected: false,

    isV2: false,

    defaultSettings: {},

    updates: \[\]

  };

  *// Hook dataLayer.push*

  const originalPush \= window.dataLayer?.push;

  window.dataLayer \= window.dataLayer || \[\];


  window.dataLayer.push \= function() {

    const args \= Array.from(arguments);

    window.\_\_gtagCalls.push({

      args,

      timestamp: Date.now()

    });

    

    *// Parse consent calls*

    if (args\[0\] \=== 'consent') {

      window.\_\_consentMode.detected \= true;

      

      if (args\[1\] \=== 'default') {

        window.\_\_consentMode.defaultSettings \= args\[2\];

        

        *// Check for V2-specific parameters*

        if (args\[2\].ad\_user\_data \!== undefined || 

            args\[2\].ad\_personalization \!== undefined) {

          window.\_\_consentMode.isV2 \= true;

        }

      }

      

      if (args\[1\] \=== 'update') {

        window.\_\_consentMode.updates.push({

          settings: args\[2\],

          timestamp: Date.now()

        });

      }

    }

    

    return originalPush?.apply(this, arguments);

  };

});

\`\`\`

\#\#\#\# Step 2: Extract Consent Mode Data

\`\`\`javascript

*// After page load*

const consentModeData \= await page.evaluate(() \=\> window.\_\_consentMode);

\`\`\`

\#\#\# Validation Rules

| Rule | Required | Description |

|------|----------|-------------|

| \`consent('default')\` called | ✅ Yes | Must set defaults BEFORE gtag('config') |

| \`ad\_storage\` present | ✅ Yes | Core parameter |

| \`analytics\_storage\` present | ✅ Yes | Core parameter |

| \`ad\_user\_data\` present | ✅ V2 Only | New in V2 (March 2024\) |

| \`ad\_personalization\` present | ✅ V2 Only | New in V2 (March 2024\) |

| Default \= \`'denied'\` | ⚖️ GDPR | All parameters should default to denied for EEA |

| \`consent('update')\` after interaction | ⚖️ GDPR | Updates only after user consent action |

\#\#\# Compliance Check Logic

\`\`\`javascript

function validateConsentModeV2(data) {

  const validation \= {

    detected: data.detected,

    isV2: data.isV2,

    compliant: false,

    issues: \[\]

  };


  if (\!data.detected) {

    validation.issues.push("Google Consent Mode not detected");

    return validation;

  }


  *// Check V2 parameters*

  const defaults \= data.defaultSettings;


  if (\!defaults.ad\_user\_data) {

    validation.issues.push("Missing 'ad\_user\_data' (V2 required)");

    validation.isV2 \= false;

  }


  if (\!defaults.ad\_personalization) {

    validation.issues.push("Missing 'ad\_personalization' (V2 required)");

    validation.isV2 \= false;

  }


  *// Check GDPR compliance (defaults should be denied)*

  \['ad\_storage', 'analytics\_storage', 'ad\_user\_data', 'ad\_personalization'\].forEach(param \=\> {

    if (defaults\[param\] \!== 'denied') {

      validation.issues.push(\`${param} should default to 'denied' for GDPR compliance\`);

    }

  });


  *// Check if updates happen (indicates consent mechanism exists)*

  if (data.updates.length \=== 0) {

    validation.issues.push("No consent updates detected \- users cannot grant consent");

  }


  validation.compliant \= validation.isV2 && validation.issues.length \=== 0;


  return validation;

}

\`\`\`

\#\#\# Example Valid V2 Configuration

\`\`\`javascript

*// Step 1: Set defaults (ALL denied)*

gtag('consent', 'default', {

  'ad\_storage': 'denied',

  'analytics\_storage': 'denied',

  'ad\_user\_data': 'denied',

  'ad\_personalization': 'denied',

  'wait\_for\_update': 500

});

*// Step 2: Load gtag*

gtag('config', 'G-XXXXXXXXXX');

*// Step 3: After user accepts \- update*

gtag('consent', 'update', {

  'analytics\_storage': 'granted'

});

\`\`\`

\#\#\# Example Invalid Configurations

❌ **\*\*Missing V2 parameters:\*\***

\`\`\`javascript

gtag('consent', 'default', {

  'ad\_storage': 'denied',

  'analytics\_storage': 'denied'

  *// Missing: ad\_user\_data, ad\_personalization*

});

\`\`\`

❌ **\*\*Defaults to granted:\*\***

\`\`\`javascript

gtag('consent', 'default', {

  'analytics\_storage': 'granted'  *// ❌ Should be 'denied'*

});

\`\`\`

❌ **\*\*No update mechanism:\*\***

\`\`\`javascript

*// Only default, no way for users to consent*

gtag('consent', 'default', {...});

*// Missing: gtag('consent', 'update')*

\`\`\`

\#\#\# Implementation File

**\*\*Location:\*\*** \`/backend/src/analyzers/consent-mode-validator.js\`

\#\#\# Output Format

\`\`\`json

{

  "consentModeV2": {

    "detected": true,

    "isV2": true,

    "compliant": false,

    "defaultSettings": {

      "ad\_storage": "denied",

      "analytics\_storage": "granted",

      "ad\_user\_data": "denied",

      "ad\_personalization": "denied"

    },

    "issues": \[

      "analytics\_storage should default to 'denied' for GDPR compliance"

    \],

    "updatesDetected": 1

  }

}

\`\`\`

\#\#\# Integration with Scanner

Add to \`scan\_results\` table in \`consent\_mode\_v2\_status\` column (TEXT/JSON).

\#\#\# Reference Documentation

\- \[Google Consent Mode V2 Official Docs\](https://support.google.com/analytics/answer/9976101)

\- Required for Google Analytics 4 and Google Ads in EEA from March 2024

\`\`\`\`

