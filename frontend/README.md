# GDPR Auditor Frontend

Next.js 14 frontend for GDPR compliance auditing tool.

## Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Development

Frontend runs on **http://localhost:3000**

Make sure backend is running on port 3001 before starting frontend.

## Environment Variables

Create `.env.local` with:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_NAME=GDPR Auditor
```

## Project Structure

```
frontend/
├── app/
│   ├── components/         # React components
│   │   ├── AuditForm.jsx        # Main audit form with validation
│   │   ├── FileUpload.jsx       # Drag-and-drop file upload
│   │   ├── LoadingSpinner.jsx   # Loading indicator
│   │   ├── StatusBadge.jsx      # Status display component
│   │   └── ResultsDisplay.jsx   # Results and report preview
│   ├── report/
│   │   └── [id]/
│   │       └── page.jsx         # Report viewer page (iframe)
│   ├── layout.jsx          # Root layout (header, footer)
│   ├── page.jsx            # Home page with audit flow
│   └── globals.css         # Global styles + CSS variables
├── tailwind.config.js      # Tailwind configuration
├── next.config.js          # Next.js configuration
└── package.json
```

## Features

### Phase 5: Frontend UI (Complete) ✅
- ✅ Audit form with URL input
- ✅ File upload component (drag-and-drop for privacy policy)
- ✅ Form validation (React Hook Form + Zod)
- ✅ Loading states and progress indicators
- ✅ Real-time audit status polling
- ✅ Report viewer page (iframe embed)
- ✅ Share functionality with copy-to-clipboard
- ✅ Results display with report preview
- ✅ Responsive design (mobile-first)

### Previous Phases (Complete)
- ✅ Phase 0: Project setup
- ✅ Phase 1: Puppeteer scanner
- ✅ Phase 2: Privacy policy analysis
- ✅ Phase 3: Risk assessment
- ✅ Phase 4: HTML report generation

## Styling

Project uses Tailwind CSS with custom color palette:

- **Primary Colors:** Blues (primary-600, primary-800, primary-900)
- **Status Colors:** Critical (red), High (orange), Medium (yellow), Low (green)
- **Neutrals:** Gray scale from 50 to 900

See `app/globals.css` for full design system.

## User Flow

1. **Home Page** (`/`)
   - Enter website URL to audit
   - Optional: Upload privacy policy file (TXT, PDF, HTML)
   - Click "Start GDPR Audit"

2. **Processing**
   - Loading spinner with real-time progress updates
   - Status polling: scanning → analyzing → generating report
   - Shows estimated time and current step

3. **Results**
   - Success message with audit ID
   - "View Full Report" button (opens report in new tab)
   - "Copy Share Link" button for sharing
   - Inline report preview (iframe)
   - "Start New Audit" button

4. **Report Page** (`/report/[id]`)
   - Full-screen iframe displaying HTML report
   - Shareable URL for clients
   - Error handling for missing reports

## API Integration

Frontend integrates with backend API at `NEXT_PUBLIC_API_URL`:

- **POST** `/api/audit/start` - Start new audit
- **GET** `/api/audit/:id/status` - Poll audit status
- **POST** `/api/audit/:id/privacy-policy` - Upload policy file
- **GET** `/api/audit/:id/report` - Get HTML report
- **GET** `/api/audit/:id/share` - Shareable report link

## Testing

1. Start backend: `cd backend && npm run dev` (port 3001)
2. Start frontend: `cd frontend && npm run dev` (port 3000)
3. Visit http://localhost:3000 and verify:
   - Page loads without errors
   - Form validation works (invalid URLs show errors)
   - File upload accepts drag-and-drop
   - Can submit audit request
   - Progress updates appear
   - Report displays after completion
   - Share link copies to clipboard
