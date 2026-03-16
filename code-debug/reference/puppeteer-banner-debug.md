# Puppeteer & Banner Debugging — CraftPolicy Primary Reference

This is the most common source of bugs in CraftPolicy. Cookie consent banners are unpredictable — they load asynchronously, depend on viewport, hide from bots, render in iframes, and use shadow DOM. Puppeteer headless mode makes all of these worse.

**If something is wrong with an audit, check the banner first.**

---

## Quick Diagnosis: What Type of Banner Problem Is It?

Start here every time. Check `banner_detection_json` in `scan_results`:

```bash
sqlite3 db.sqlite "SELECT banner_detection_json FROM scan_results WHERE audit_uid='AUDIT_UID'"
```

| What You See | What It Means | Go To Section |
|---|---|---|
| `null` | The banner detection step crashed entirely | Section 1 |
| `"found": false, "viewport": "desktop"` | Banner not found at desktop, mobile retry also failed | Section 2 |
| `"found": true, "viewport": "mobile"` | Banner renders only on mobile — desktop users get no consent | Section 3 |
| `"found": true` but noyb checks all `skipped: true` | Banner was found but DOM elements disappeared before checks ran | Section 4 |
| `"found": true` but wrong violation results | Banner was found but checks produced incorrect results | Section 5 |
| Audit stuck in PROCESSING, never completes | Puppeteer hung or crashed during navigation | Section 6 |

---

## Section 1: Banner Detection Step Crashed (NULL in database)

**Symptom:** `banner_detection_json` is NULL. The step threw an error.

**Diagnosis steps:**

1. Check Railway logs for the step failure:
   ```
   Filter logs by: "stepBannerCompliance" OR "cookie-banner-checker"
   Look for: "level": "error"
   ```

2. Common causes:

   **Page was destroyed before banner check ran:**
   ```json
   { "error": "Execution context was destroyed, most likely because of a navigation" }
   ```
   This means another part of the code navigated away while the banner check was running. In the parallel batch, if any step triggers navigation (redirect, meta refresh), all parallel steps sharing `context.page` will fail.
   
   **Fix direction:** Check if the website being audited has a redirect. If the page URL changes after initial load, the banner check runs on the wrong page. Add a log in `scan-phase-browser.js:stepNavigate` to capture the final URL after navigation.

   **Puppeteer timeout:**
   ```json
   { "error": "Navigation timeout of 30000 ms exceeded" }
   ```
   The website took too long to load. This is common for heavy eCommerce sites with many third-party scripts.
   
   **Fix direction:** This is a site-specific issue, not a bug. The audit should handle timeouts gracefully — check that the step function has try/catch and writes partial results to context instead of throwing.

   **Out of memory:**
   ```json
   { "error": "Page crashed!" }
   ```
   Railway container ran out of memory. Puppeteer Chromium uses ~200MB. If the scanned website is heavy (many images, SPAs with large JS bundles), memory can spike.
   
   **Fix direction:** Not a code bug. Consider adding `--disable-dev-shm-usage` flag in `puppeteer-setup.js` if not already present. Check Railway container memory limits.

---

## Section 2: Banner Not Found at Any Viewport

**Symptom:** `"found": false` after both desktop and mobile retry.

**This has 5 possible causes. Check them in order:**

### Cause A: The Website Genuinely Has No Banner

Not every website has a cookie banner. If the website doesn't use cookies that require consent (no analytics, no tracking), it legitimately may not have a banner.

**How to verify:** Open the website manually in a normal browser. Is there a banner? If no → correct behavior, not a bug.

### Cause B: The CMP Selector Is Not in the Known List

`waitForBannerVisible()` searches for these selectors:
```
#cookiescript_injected
#onetrust-banner-sdk
#CybotCookiebotDialog
[data-testid="uc-privacy-banner"]
[id*="cookie"]
[class*="consent"]
[role="dialog"]
```

If the website uses a CMP with a different selector, the banner won't be found.

**How to diagnose:**
1. Open the website in Chrome
2. Right-click the banner → Inspect
3. Look at the banner's outermost container element
4. Note its `id`, `class`, or other identifying attribute
5. Check if any of the selectors above would match it

**Fix:** Add the new CMP selector to the list in `cookie-banner-checker.js:waitForBannerVisible()`. This is a data update, not a logic change.

**Common CMPs not in the default list that you may encounter on Bulgarian/EU sites:**
- CookieYes: `#cookie-law-info-bar`
- Complianz: `#cmplz-cookiebanner-container`
- Iubenda: `#iubenda-cs-banner`
- Cookie Notice by TrustArc: `#truste-consent-track`
- Custom WordPress plugins: highly variable — check the site manually

### Cause C: The Banner Loads Inside a Cross-Origin iframe

Some CMPs inject their banner from a different domain (e.g., `consent.cookiebot.com`). Puppeteer's `page.evaluate()` cannot access cross-origin iframe content due to same-origin policy.

**How to diagnose:**
1. Open the website in Chrome → Developer Tools → Elements tab
2. Search for `<iframe` elements
3. Check if the banner is inside an iframe with a different domain than the page
4. If yes → Puppeteer cannot see it

**This is a known limitation.** There is no simple fix. Options:
- For specific CMPs, check if there's a JavaScript API on the main page (e.g., `window.Cookiebot`, `window.OneTrust`) that indicates the CMP is loaded even if the banner is in an iframe
- Flag in the report as "CMP detected but banner rendered in cross-origin iframe — manual verification required"
- Do NOT try to use `page.frames()` with cross-origin access — it won't work

### Cause D: The CMP Detects Headless Chrome and Hides the Banner

Some CMPs intentionally suppress the banner for bots to avoid polluting analytics.

**Detection methods CMPs use:**
- `navigator.webdriver === true` (Puppeteer default)
- Missing Chrome plugins (`navigator.plugins.length === 0`)
- Missing `window.chrome` object
- User-agent string containing "HeadlessChrome"
- WebGL fingerprinting anomalies

**How to diagnose:**
1. Check `puppeteer-setup.js` — are stealth flags set?
2. Key flags that should be present:
   ```javascript
   '--disable-blink-features=AutomationControlled'
   ```
3. Check if the page has `navigator.webdriver` overridden:
   ```javascript
   await page.evaluateOnNewDocument(() => {
     Object.defineProperty(navigator, 'webdriver', { get: () => false });
   });
   ```

**Fix direction:** Add missing stealth measures to `puppeteer-setup.js`. But be aware: sophisticated CMPs (OneTrust enterprise, Cookiebot enterprise) may use server-side fingerprinting that client-side stealth cannot defeat.

### Cause E: The Banner Loads Too Late (After the 10-Second Timeout)

Some CMPs initialize very slowly, especially if they:
- Load from a slow CDN
- Wait for other scripts to finish first
- Use `requestIdleCallback` or `setTimeout` for deferred loading

**How to diagnose:**
Check the `timeMs` field in `banner_detection_json`. If it's exactly 10000 (the timeout value), the banner may have loaded at 11 seconds.

**Fix direction:** Increase the timeout in `waitForBannerVisible()` from 10000 to 15000ms. This adds 5 seconds to scan time for sites where the banner is genuinely absent, but catches slow CMPs. Trade-off: acceptable for an internal tool.

---

## Section 3: Banner Found Only on Mobile

**Symptom:** `"found": true, "viewport": "mobile"`

This means the banner was NOT found at the desktop viewport (1920×1080 or similar) but WAS found after resizing to 375×812 (mobile).

**This is a real GDPR finding, not a bug.** Desktop users are not presented with a consent mechanism. The report should flag this as `BANNER_MOBILE_ONLY`.

**However, verify it's not a false positive:**
1. Open the website on your actual desktop browser — is the banner visible?
2. If yes → the Puppeteer desktop viewport size might differ from your browser
3. Check `puppeteer-setup.js` — what viewport is configured?
4. Some CMPs use breakpoints at specific widths (e.g., 1024px, 1280px). If Puppeteer uses a viewport just outside the breakpoint, the banner won't render.

**Fix for false positives:** Adjust the desktop viewport in `puppeteer-setup.js` to match a common real-world resolution. 1366×768 is the most common desktop resolution globally and is a safer default than 1920×1080.

---

## Section 4: Banner Found but Checks All Skipped

**Symptom:** `banner_detection_json` shows `"found": true` but `banner_violations_json` shows all checks as `"skipped": true`.

**This means the banner was detected by `waitForBannerVisible()` but by the time the individual checks ran, the DOM elements were no longer accessible.**

**Why this happens:**
1. **Banner auto-dismissed:** Some CMPs auto-dismiss the banner after a few seconds if no interaction occurs. The banner detection finds it, but by the time type_a/type_b checks run (which iterate all 7 checks sequentially), the banner has disappeared.
   
2. **SPA navigation:** Single-page applications may re-render the DOM between the banner detection and the individual checks, destroying the banner element.

3. **CSS animation:** The banner may be "found" (element exists in DOM) but visually hidden via CSS transition. The `offsetWidth * offsetHeight` measurements in type_e return 0, and button text searches fail.

**How to diagnose:**
Add a temporary diagnostic in `cookie-banner-checker.js`, after `detectBannerWithRetry()` succeeds and before the violation checks loop:

```javascript
// TEMPORARY DIAGNOSTIC — remove after debugging
const bannerStillVisible = await page.evaluate(() => {
  const selectors = ['#cookiescript_injected', '#onetrust-banner-sdk', 
    '#CybotCookiebotDialog', '[id*="cookie"]', '[class*="consent"]'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const rect = el.getBoundingClientRect();
      return { selector: sel, width: rect.width, height: rect.height, 
               display: window.getComputedStyle(el).display,
               visibility: window.getComputedStyle(el).visibility };
    }
  }
  return null;
});
logger.debug({ event: 'banner_still_visible_before_checks', result: bannerStillVisible });
```

If this returns `null` or shows `display: none` / `visibility: hidden`, the banner disappeared between detection and checks.

**Fix direction:** 
- Capture the banner selector that matched during detection and pass it to the individual checks — they should scope their queries to the banner container, not search the full page
- Add a 500ms stability wait between banner detection and the first check
- If the banner auto-dismisses, consider this itself a finding: "Consent banner dismisses automatically without user interaction"

---

## Section 5: Banner Found but Wrong Violation Results

**Symptom:** Banner detected, checks ran, but results don't match what you see manually.

**Most common causes:**

### Wrong buttons found (type_a false positive/negative)

The button search uses text-matching across multiple languages. It might find an unrelated button ("Accept Terms of Service" instead of "Accept Cookies"), or miss a button with unusual text.

**Diagnose:** Add a temporary log to see which buttons were found:
```javascript
// In checkNoRejectButton(), log the found buttons:
logger.debug({
  event: 'buttons_found',
  accept: acceptButtons.map(b => ({ text: b.textContent.trim(), tagName: b.tagName })),
  reject: rejectButtons.map(b => ({ text: b.textContent.trim(), tagName: b.tagName })),
});
```

### Color/size comparison wrong (type_d, type_e false results)

The dark pattern checks compare Accept and Reject buttons. If the wrong elements are identified as the buttons, the comparison is meaningless.

**Diagnose:** Log the elements being compared and their computed styles.

### Shadow DOM elements not found

Some modern CMPs (especially Usercentrics, ConsentManager) use Shadow DOM. Standard `document.querySelector()` cannot penetrate shadow roots.

**How to check:** Open Chrome DevTools on the target site, look at the banner element. If you see `#shadow-root` in the element tree, the banner uses Shadow DOM.

**Current behavior:** `waitForBannerVisible()` includes shadow DOM piercing in its search. But the individual violation checks (type_a through type_k) may NOT search inside shadow roots.

**Fix direction:** Ensure all `page.evaluate()` calls in the violation checks also pierce shadow DOM, not just the banner detection function.

---

## Section 6: Audit Stuck in PROCESSING (Puppeteer Hang)

**Symptom:** Audit was started but never reaches `completed` or `failed`. `progress_json` shows the last step but doesn't advance.

**Diagnosis steps:**

1. **Check which step it stopped at:**
   ```bash
   curl https://YOUR-URL/api/audit/AUDIT_UID/status -H "x-api-key: KEY"
   # Look at progress_json → last step number
   ```

2. **Common hang points:**

   | Last Step | Likely Cause |
   |---|---|
   | Step 1 (browser launch) | Chromium failed to start on Railway — check memory |
   | Step 1 (navigation) | Target website is unreachable or infinite redirect |
   | Step 6.6 (consent mode wait) | Polling for `google_tag_data.ics` — site has no GTM, waits full 15 seconds (not a hang, just slow) |
   | Step 10 (banner check) | `waitForBannerVisible` 10s timeout + mobile retry 10s + reflow waits = up to 25 seconds total |
   | Step 16 (consent simulation) | If `SKIP_CONSENT_CHECK` is not set, audit enters PAUSED state waiting for manual interaction |

3. **Is it actually hung or just slow?**
   A normal audit takes 30–60 seconds. Steps 6.6 (15s max) and 10 (25s max) are the slowest. A total scan under 2 minutes is normal. Only investigate if it's been more than 5 minutes.

4. **True hang — Puppeteer process is stuck:**
   ```bash
   # On Railway shell:
   ps aux | grep chrome
   # If multiple zombie Chromium processes → memory leak
   # Restart the service
   ```

**Prevention:** Ensure `scan-phase-finalize.js:stepCloseBrowser` runs even on failure. The step-runner should call browser close in a `finally` block, not just on success. If browser close is only called on the happy path, a failure at any step leaks a Chromium process.

---

## Section 7: Adding a New CMP to the Detection List

When you encounter a website whose banner is not detected, and you've verified manually that a banner exists:

1. Open the website in Chrome → Inspect the banner element
2. Find the most unique, stable selector (prefer `id` over `class`):
   - `id="iubenda-cs-banner"` → use `#iubenda-cs-banner`
   - `class="cc-window"` → use `.cc-window`
   - `data-testid="consent-banner"` → use `[data-testid="consent-banner"]`
3. Open `backend/src/analyzers/cookie-banner-checker.js`
4. Find `waitForBannerVisible()` → find the selector array
5. Add your new selector to the array
6. Test with the specific website that failed
7. Run `npm test` to verify no regressions

**Keep a list** of CMPs encountered on Bulgarian/EU websites and their selectors. Over time, this becomes a competitive advantage — your tool detects banners that others miss.

---

## Puppeteer Debugging Cheat Sheet

Quick reference for common Puppeteer diagnostic commands:

```javascript
// Check if page is still alive:
const isAlive = !context.page.isClosed();

// Get current URL (did a redirect happen?):
const currentUrl = context.page.url();

// Get page title (is the right page loaded?):
const title = await context.page.title();

// Count iframes:
const iframeCount = context.page.frames().length;

// Check viewport:
const viewport = context.page.viewport(); // { width, height }

// Get all cookies:
const cookies = await context.page.cookies();

// Check for JavaScript errors on the page:
context.page.on('pageerror', err => logger.debug({ event: 'page_js_error', error: err.message }));

// Check for failed network requests:
context.page.on('requestfailed', req => logger.debug({ 
  event: 'request_failed', 
  url: req.url(), 
  reason: req.failure()?.errorText 
}));

// Take a diagnostic screenshot (if screenshots are enabled):
await context.page.screenshot({ path: '/tmp/debug-banner.png', fullPage: true });
```

**Remember:** Remove all diagnostic code after debugging. It should not run in production scans.

---

## How to Ask Claude Code to Debug Banner Issues

Template for maximum effectiveness:

```
The audit for [URL] has a banner problem: [describe what you see].

Before proposing any fix:
1. Read cookie-banner-checker.js — specifically waitForBannerVisible() 
   and detectBannerWithRetry()
2. Check banner_detection_json in scan_results for audit [UID]
3. Check Railway logs filtered by "cookie-banner-checker" for this audit
4. Open the website URL in a way that lets you see if the banner 
   exists and what CMP it uses (check the page source for CMP scripts)
5. Tell me: which section of puppeteer-banner-debug.md matches 
   this problem? (Section 1-7)

DO NOT change any code until you tell me the root cause.
```
