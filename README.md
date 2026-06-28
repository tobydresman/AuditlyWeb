# Accessibility Checker

A website accessibility scanner built with axe-core and Playwright.
Scans any public URL for WCAG 2.1 AA violations and returns a scored
report with fix guidance and estimated dev time.

---

## Setup (takes about 3 minutes)

### 1. Install dependencies

```bash
npm install
```

### 2. Install the Chromium browser (used for headless scanning)

```bash
npm run install-browsers
```

### 3. Start the server

```bash
npm start
```

Then open http://localhost:3000 in your browser.

---

## How it works

1. User enters a URL in the frontend
2. The Express server launches a headless Chromium browser via Playwright
3. It navigates to the URL, injects axe-core, and runs a full WCAG 2.1 AA scan
4. Results are scored (0–100), enriched with human-readable explanations,
   grouped by impact level, and returned as JSON
5. The frontend renders the report with accordion cards, affected elements,
   and fix guidance

---

## Project structure

```
accessibility-checker/
├── server.js          ← Express server + scan logic
├── public/
│   └── index.html     ← Frontend (single file, no build step)
├── package.json
└── README.md
```

---

## Integrating into your main website

The scan API is a single POST endpoint:

```
POST /api/scan
Content-Type: application/json

{ "url": "https://example.com" }
```

Response:
```json
{
  "url": "https://example.com",
  "score": 72,
  "summary": {
    "total": 8,
    "critical": 2,
    "serious": 3,
    "moderate": 2,
    "minor": 1,
    "passes": 41,
    "estimatedFix": "3.5 hours"
  },
  "violations": [...],
  "grouped": {
    "critical": [...],
    "serious": [...],
    "moderate": [...],
    "minor": [...]
  }
}
```

Each violation includes:
- `id` — axe-core rule ID
- `impact` — critical / serious / moderate / minor
- `help` — short human-readable title
- `why` — plain English explanation of why it matters
- `fix` — plain English fix instructions
- `wcag` — relevant WCAG criterion
- `affectedCount` — number of elements affected
- `examples` — first 3 affected HTML elements

---

## Deploying

Any Node.js host works. Recommended options:

- **Railway** — simplest, free tier available (railway.app)
- **Render** — free tier, good for side projects (render.com)
- **VPS (DigitalOcean/Hetzner)** — cheapest long term, full control

Make sure your host supports running Chromium. Railway and Render both do.
You may need to set this env variable on some hosts:

```
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
```

---

## Monetisation hooks (to add next)

- [ ] Stripe payment wall before showing full report (£19)
- [ ] Email capture — send report to inbox
- [ ] "Get a fix quote" CTA emails you directly (already in the UI)
- [ ] Monthly monitoring — re-scan weekly, email diffs
- [ ] White-label mode — agency uploads logo, charges their clients
