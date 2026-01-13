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
│   ├── layout.jsx          # Root layout
│   ├── page.jsx            # Home page
│   ├── globals.css         # Global styles
│   └── audit/              # Audit pages (Phase 5)
│       └── [id]/
│           └── page.jsx    # Audit report viewer
├── components/             # React components (Phase 5)
│   ├── audit/
│   │   ├── AuditForm.jsx
│   │   ├── FileUpload.jsx
│   │   └── LoadingState.jsx
│   └── ui/
│       ├── Button.jsx
│       ├── Card.jsx
│       └── Input.jsx
├── lib/                    # Utilities
│   ├── api.js             # API client
│   └── utils.js           # Helper functions
├── tailwind.config.js      # Tailwind configuration
├── next.config.js          # Next.js configuration
└── package.json
```

## Features

### Phase 0 (Current)
- ✅ Basic homepage
- ✅ API health check display
- ✅ Responsive layout with Tailwind CSS
- ✅ Design system with GDPR color palette

### Phase 5 (Coming)
- ⏳ Audit request form
- ⏳ File upload (drag & drop)
- ⏳ Progress tracking
- ⏳ Report viewer
- ⏳ Share functionality

## Styling

Project uses Tailwind CSS with custom color palette:

- **Primary Colors:** Blues (primary-600, primary-800, primary-900)
- **Status Colors:** Critical (red), High (orange), Medium (yellow), Low (green)
- **Neutrals:** Gray scale from 50 to 900

See `app/globals.css` for full design system.

## Testing

Visit http://localhost:3000 and verify:
- Page loads without errors
- API status shows "Connected"
- All feature cards display correctly
- Responsive design works on mobile
