const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Load axe-core source once at startup
const axeSource = fs.readFileSync(
  path.join(__dirname, "node_modules/axe-core/axe.min.js"),
  "utf8"
);

// ─── Scoring ────────────────────────────────────────────────────────────────

const IMPACT_WEIGHTS = { critical: 25, serious: 15, moderate: 8, minor: 3 };

function calculateScore(violations) {
  if (!violations.length) return 100;
  const penalty = violations.reduce((total, v) => {
    const weight = IMPACT_WEIGHTS[v.impact] || 5;
    // Cap per-issue penalty so one critical doesn't tank everything unfairly
    return total + Math.min(weight * v.nodes.length, weight * 3);
  }, 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

// ─── Friendly descriptions ───────────────────────────────────────────────────

const DESCRIPTIONS = {
  "image-alt": {
    why: "Screen readers read out alt text to describe images to blind users. Without it, they hear nothing or a file name like 'IMG_4821.jpg'.",
    fix: 'Add descriptive alt attributes to every <img> tag. E.g. <img src="logo.png" alt="Acme Co logo">. If an image is decorative, use alt="".',
  },
  "color-contrast": {
    why: "Low contrast text is hard to read for people with visual impairments or in bright sunlight. WCAG requires a 4.5:1 ratio for normal text.",
    fix: "Use a contrast checker tool and darken your text colour or lighten your background until the ratio passes.",
  },
  "label": {
    why: "Form inputs without labels leave screen reader users unable to understand what the field is for.",
    fix: 'Add a <label for="inputId"> element that matches the input\'s id, or use aria-label on the input directly.',
  },
  "button-name": {
    why: "Buttons without accessible names are announced as 'button' with no context, making them unusable for screen reader users.",
    fix: "Add descriptive text inside the button, or use aria-label if the button is icon-only. E.g. <button aria-label=\"Close menu\">✕</button>.",
  },
  "link-name": {
    why: '"Click here" and icon-only links give no context to screen reader users about where the link goes.',
    fix: "Use descriptive link text like 'Read our accessibility guide' or add aria-label to icon links.",
  },
  "heading-order": {
    why: "Screen reader users navigate pages by headings. Skipping levels (h1 → h3) breaks that mental map.",
    fix: "Use headings in order: h1 for the page title, h2 for sections, h3 for subsections. Don't skip levels.",
  },
  "duplicate-id": {
    why: "Duplicate IDs break ARIA relationships and cause assistive technologies to behave unpredictably.",
    fix: "Make sure every id attribute on the page is unique. Use a linter to catch these automatically.",
  },
  "html-has-lang": {
    why: "Without a language attribute, screen readers may use the wrong pronunciation engine.",
    fix: 'Add a lang attribute to your <html> tag. E.g. <html lang="en">.',
  },
};

function enrich(violation) {
  const info = DESCRIPTIONS[violation.id] || null;
  return {
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    wcag: violation.tags
      .filter((t) => t.startsWith("wcag"))
      .join(", ")
      .toUpperCase()
      .replace(/WCAG/g, "WCAG ")
      .trim(),
    affectedCount: violation.nodes.length,
    why: info?.why || null,
    fix: info?.fix || null,
    // First 3 affected elements so the dev can find them quickly
    examples: violation.nodes.slice(0, 3).map((n) => ({
      html: n.html,
      target: n.target?.[0] || null,
      failureSummary: n.failureSummary,
    })),
  };
}

// ─── Estimate fix time ────────────────────────────────────────────────────────

const FIX_MINUTES = {
  critical: 45,
  serious: 30,
  moderate: 20,
  minor: 10,
};

function estimateTime(violations) {
  const minutes = violations.reduce((total, v) => {
    const perIssue = FIX_MINUTES[v.impact] || 15;
    return total + Math.min(perIssue * v.nodes.length, perIssue * 4);
  }, 0);
  if (minutes < 60) return `${minutes} minutes`;
  const hrs = Math.round(minutes / 30) / 2;
  return `${hrs} hour${hrs !== 1 ? "s" : ""}`;
}

// ─── Scan endpoint ────────────────────────────────────────────────────────────

app.post("/api/scan", async (req, res) => {
  let { url } = req.body;

  if (!url) return res.status(400).json({ error: "URL is required." });

  // Normalise URL
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (compatible; AccessibilityChecker/1.0; +https://yoursite.com)",
    });
    const page = await context.newPage();

    // Navigate with a generous timeout
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Inject axe-core and run
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async () => {
      return await axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
        },
      });
    });

    await browser.close();

    const violations = results.violations.map(enrich);
    const passes = results.passes.length;
    const score = calculateScore(results.violations);
    const estimatedFix = estimateTime(results.violations);

    // Group by impact
    const grouped = {
      critical: violations.filter((v) => v.impact === "critical"),
      serious: violations.filter((v) => v.impact === "serious"),
      moderate: violations.filter((v) => v.impact === "moderate"),
      minor: violations.filter((v) => v.impact === "minor"),
    };

    res.json({
      url,
      score,
      violations,
      grouped,
      summary: {
        total: violations.length,
        critical: grouped.critical.length,
        serious: grouped.serious.length,
        moderate: grouped.moderate.length,
        minor: grouped.minor.length,
        passes,
        estimatedFix,
      },
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});

    const msg = err.message || "";
    if (msg.includes("net::ERR") || msg.includes("timeout")) {
      return res.status(422).json({
        error: "Could not reach that URL. Check it's publicly accessible and try again.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Scan failed. Please try again." });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Accessibility checker running at http://localhost:${PORT}`);
});
