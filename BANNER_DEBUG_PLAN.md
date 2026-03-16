# Banner Detection & noyb Checklist — Comprehensive Fix Plan

## Investigation Findings (code-debug skill, Phase 1 Complete)

### Evidence Summary

The banner detection and ALL noyb violation checks are **architecturally broken** in two independent ways that compound into completely wrong audit results.

---

## ROOT CAUSE 1: CookieScript Viewport-Dependent Banner Hiding

**What happens:**
```
Page loads at desktop viewport (1920×1080)
  → CookieScript renders banner (FLASH — visible for ~200ms)
  → CookieScript runs responsive check
  → At large viewport, CookieScript hides banner via CSS/JS
  → Banner element stays in DOM but is display:none or height:0
  → waitForBannerVisible() either catches the flash OR times out
```

**Why mobile toggle fixes it:**
CookieScript uses a responsive breakpoint. When you toggle the device toolbar in DevTools (changing viewport), it triggers a CSS media query re-evaluation and/or a `resize` event handler in CookieScript that re-shows the banner at the smaller viewport.

**This is NOT bot detection.** The stealth hardening (commit 2) was addressing the wrong hypothesis. This is a **CMP responsive design behavior** — the banner is intentionally hidden at large desktop viewports by CookieScript itself.

**Evidence:**
- The CSS you showed: `.cookiescript_overlay { height: 100vh }` and `@media print { display:none }` — CookieScript controls visibility via CSS
- The banner appears when toggling to ANY device viewport in DevTools — not just mobile phones
- The `#cookiescript_injected` DIV exists in DOM but is hidden (the element is present but not visible)
- This happens in manual browser too, not just headless — ruling out bot detection

**The current `waitForBannerVisible()` checks `offsetHeight > 0 && offsetWidth > 0`** — if CookieScript sets the banner to `display:none` or `height:0`, both values return 0 and detection fails.

### What needs to change:
The banner detection and ALL checks need to run at a **viewport where the banner is actually visible**. Since mobile viewport (375×812) reliably triggers the banner, the strategy should be:

1. Try desktop first
2. If not found → switch to mobile viewport BEFORE running checks (already done in `detectBannerWithRetry`)
3. **CRITICAL: Stay at mobile viewport for the noyb checks** — don't switch back to desktop before running them

Currently `detectBannerWithRetry()` switches to mobile, finds the banner, then **switches BACK to desktop viewport** before returning (lines 196-202). This means by the time the noyb checks run, the viewport is back to desktop and the banner is hidden again.

---

## ROOT CAUSE 2: noyb Checks Search ENTIRE Page DOM, Not Banner Container

This is the more fundamental architectural problem. Every single noyb check function has the same flaw:

### Type A (`checkNoRejectButton`) — Lines 484-562
```javascript
// Searches ALL buttons on the ENTIRE page:
buttons.push(...Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]')));
```
- Finds **73 buttons** across the whole page
- Matches "Cookie Consent Service" as accept text (this is a navigation link/label, NOT the accept button)
- Cannot find reject button because it's looking at page-level buttons, not banner buttons
- **Result: FALSE POSITIVE** — reports "No Reject Button" when reject button exists inside the banner

### Type B (`checkPreTickedBoxes`) — Lines 603-631
```javascript
document.querySelectorAll('input[type="checkbox"]:checked')
```
- Searches ALL checkboxes on the entire page (forms, filters, etc.)
- Any checked checkbox on the page triggers this, even if unrelated to consent

### Type C (`checkDeceptiveLinkDesign`) — Lines 660-693
```javascript
const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
```
- Searches entire page for accept button and settings link
- May find wrong elements on pages with "accept" text in other contexts (ToS, etc.)

### Type D (`checkDeceptiveButtonColors`) — Lines 728-790
```javascript
const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
```
- Same problem — finds wrong accept/reject buttons from page-level elements

### Type E (`checkDeceptiveButtonContrast`) — Lines 862-907
```javascript
const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
```
- Same problem — compares sizes/styles of wrong elements

### Type H (`checkLegitimateInterestForAds`) — Lines 950-977
```javascript
const bodyText = document.body.innerText.toLowerCase();
```
- Searches ENTIRE page body text — this might actually be correct behavior for this check since legitimate interest claims can appear anywhere, but should ideally be scoped to consent-related elements

### Type K (`checkDifficultConsentWithdrawal`) — Lines 1053-1100
```javascript
const allLinks = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
```
- Searches entire page — this is actually correct for this check since withdrawal mechanisms should be persistent and visible anywhere on the page

### The Pattern:
**Types A, B, C, D, E all search `document.querySelectorAll(...)` on the full page instead of scoping to the banner container.** The banner selector matched by `waitForBannerVisible()` is NEVER passed to any check function.

Look at the call chain:
```
analyzeCookieBanner()
  → detectBannerWithRetry() returns { found, selector: '#cookiescript_injected', ... }
  → bannerDetectionStatus.selector = '#cookiescript_injected'  // KNOWN!
  → for (violation of noybViolations.violations)
      → checkViolation(page, violation, ...)  // selector NOT passed!
          → checkNoRejectButton(page, violation)  // searches entire document
```

The banner selector is known but never used to scope the checks.

---

## ROOT CAUSE 3: Type A Calls `waitForBannerVisible()` AGAIN

Inside `checkNoRejectButton()` (line 475):
```javascript
const bannerResult = await waitForBannerVisible(page, 10000);
```

This is a **second, independent** 10-second banner detection wait INSIDE the type_a check, AFTER `analyzeCookieBanner()` already detected the banner. This means:

1. `analyzeCookieBanner()` calls `detectBannerWithRetry()` — waits up to 30s (desktop 15s + mobile 15s)
2. Banner found at mobile viewport → viewport restored to desktop → banner disappears
3. For EACH violation check, the check runs against the desktop viewport where banner is hidden
4. Type A specifically calls `waitForBannerVisible()` AGAIN for another 10s — redundant and wasteful
5. Even if this second detection succeeds, the button search below it still searches the entire page

---

## COMPREHENSIVE FIX PLAN

### Fix 1: Keep Viewport at Mobile When Banner Found There
**File:** `cookie-banner-checker.js` → `detectBannerWithRetry()`

**Current behavior (BROKEN):**
```
Desktop detection fails → switch to mobile → banner found → switch BACK to desktop → return
```

**New behavior:**
```
Desktop detection fails → switch to mobile → banner found → STAY at mobile → return
→ After ALL noyb checks complete → THEN restore desktop viewport
```

The viewport restoration should happen in `analyzeCookieBanner()` AFTER the violation check loop, not inside `detectBannerWithRetry()`.

### Fix 2: Pass Banner Selector to ALL Check Functions — Scope Queries to Banner Container
**File:** `cookie-banner-checker.js` → ALL check functions

**Change the call chain:**
```javascript
// CURRENT (broken):
checkViolation(page, violation, debugSessionId, cookies)

// NEW:
checkViolation(page, violation, debugSessionId, cookies, bannerSelector)
```

Where `bannerSelector` is the selector matched by `detectBannerWithRetry()` (e.g., `'#cookiescript_injected'`).

**Each check function must scope its queries:**
```javascript
// CURRENT (type_a — searches entire page):
document.querySelectorAll('button, a, div[role="button"], span[role="button"]')

// NEW (type_a — searches only inside banner):
const banner = document.querySelector(bannerSelector);
if (!banner) return { ... skipped ... };
banner.querySelectorAll('button, a, div[role="button"], span[role="button"]')
```

**Checks to scope (MUST be inside banner):**
- Type A: Button search → `banner.querySelectorAll(...)`
- Type B: Checkbox search → `banner.querySelectorAll('input[type="checkbox"]:checked')`
- Type C: Accept button + settings link → `banner.querySelectorAll(...)`
- Type D: Accept/reject button colors → `banner.querySelectorAll(...)`
- Type E: Accept/reject button sizes → `banner.querySelectorAll(...)`

**Checks that should remain page-wide (intentionally):**
- Type H: Legitimate interest claims — can appear in privacy policy, not just banner
- Type K: Consent withdrawal mechanism — should be persistent outside the banner

**Type I (misclassified cookies) uses cookie data, not DOM — no change needed.**

### Fix 3: Remove Redundant `waitForBannerVisible()` Inside Type A
**File:** `cookie-banner-checker.js` → `checkNoRejectButton()`

Remove the redundant call on line 475:
```javascript
// REMOVE THIS — banner was already detected by analyzeCookieBanner()
const bannerResult = await waitForBannerVisible(page, 10000);
```

The banner visibility is already confirmed by `detectBannerWithRetry()` before any checks run. If the banner disappeared (Root Cause 1), re-detecting it won't help because the button search still scopes to the full page.

### Fix 4: Add Banner Stability Check Before Running Checks
**File:** `cookie-banner-checker.js` → `analyzeCookieBanner()`

After `detectBannerWithRetry()` succeeds and before the violation loop, verify the banner is still visible:

```javascript
// After detectBannerWithRetry() returns found:true
// Verify banner is still in DOM and visible before running checks
const bannerStillVisible = await page.evaluate((selector) => {
  const el = document.querySelector(selector);
  if (!el) return { visible: false, reason: 'element_removed' };
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return { visible: false, reason: 'display_none' };
  if (style.visibility === 'hidden') return { visible: false, reason: 'visibility_hidden' };
  if (el.offsetHeight === 0) return { visible: false, reason: 'zero_height' };
  return { visible: true };
}, bannerDetectionStatus.selector);
```

If banner is NOT stable:
- Log a diagnostic warning with the reason
- Try re-triggering visibility by setting mobile viewport (if not already mobile)
- If still hidden after viewport change, report as a finding: "Banner auto-hides — consent mechanism not persistently visible"

### Fix 5: Add Detailed Evidence Logging to ALL Checks
**File:** `cookie-banner-checker.js` → ALL check functions

Currently type_b and type_c return pass/fail with no detail. Every check should log:
- What elements were found
- What selector was used to scope
- Whether the banner container was accessible
- The specific values compared (for style checks)

This makes Railway logs actionable for debugging.

---

## Implementation Order (ONE change per commit)

1. **Fix 1** — Viewport retention (keep mobile if banner found there)
2. **Fix 2** — Pass banner selector and scope ALL check queries to banner container
3. **Fix 3** — Remove redundant `waitForBannerVisible()` in type_a
4. **Fix 4** — Banner stability check before noyb loop
5. **Fix 5** — Enhanced evidence logging

Each commit: run `npm test` (all 61 must pass), then deploy and run one test audit.

---

## Risk Assessment

- **Fix 1** is the most impactful — solves the immediate "banner disappears" problem
- **Fix 2** is the most complex — touches all check functions but fixes the fundamental scoping bug
- **Fix 3** is trivial — removes dead code
- **Fix 4** is defensive — catches edge cases where banner hides between detection and checks
- **Fix 5** is diagnostic — no behavior change, just better observability

**Global safety constraint:** None of these changes touch `confirmed-tracking-filter.js` (SSOT). All changes are in `cookie-banner-checker.js` only.

---

## Follow-up Questions for User

1. What specific website URL are you testing? (Needed to verify the CookieScript behavior)
2. Is the Railway deployment using `PUPPETEER_HEADLESS=true`? (Affects which headless mode is active)
3. Do you want the checks to FAIL when the banner is hidden (report it as a finding), or should the system force the banner visible before checking?
