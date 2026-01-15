# noyb Cookie Banner Violations - Implementation Detection Guide

**Source:** noyb Cookie Banner Report 2024 + EDPB Guidelines 05/2020  
**Purpose:** Precise detection criteria for automated Puppeteer-based cookie banner auditing  
**Status:** Production-ready specification based on 600+ DPA complaints

---

## LEGAL FRAMEWORK

**Primary Legislation:**
- GDPR Article 4(11): Consent definition
- GDPR Article 7(4): Freely given consent assessment
- ePrivacy Directive Article 5(3): Cookie consent requirement

**Enforcement Bodies:**
- EDPB Cookie Banner Taskforce Report (January 2023)
- National DPA Guidelines (27 EU member states)

**Key Principle:** Consent must be **freely given, specific, informed, and unambiguous**

---

## TYPE A: No Reject Button on First Layer

### Legal Basis
- **GDPR:** Article 7(4) - freely given consent
- **ePrivacy:** Article 5(3) - consent before storing cookies
- **EDPB Position:** Reject option must be equally prominent as accept option

### Violation Description
Cookie banner lacks an equally prominent reject button on the first layer (initial banner view). Users must navigate to second layer (settings) to refuse consent.

### Detection Method - Puppeteer

**Step 1: Identify Banner Container**
```javascript
// Find cookie banner (common selectors)
const bannerSelectors = [
  '[id*="cookie"]', '[class*="cookie"]',
  '[id*="consent"]', '[class*="consent"]',
  '[role="dialog"][aria-label*="cookie" i]'
];
```

**Step 2: Locate Accept Button**
```javascript
// Common accept button patterns
const acceptSelectors = [
  'button:has-text("Accept")',
  'button:has-text("Agree")',
  'button[data-action*="accept"]',
  'button[id*="accept"]'
];
```

**Step 3: Locate Reject Button on FIRST LAYER**
```javascript
// Must be actual BUTTON element, not link
const rejectSelectors = [
  'button:has-text("Reject")',
  'button:has-text("Decline")',
  'button[data-action*="reject"]',
  'button[id*="reject"]'
];
```

**Step 4: Check Same Layer Presence**
```javascript
// Both must be visible WITHOUT clicking "Settings" or "Manage"
const acceptVisible = acceptButton && await acceptButton.isVisible();
const rejectVisible = rejectButton && await rejectButton.isVisible();
```

### Pass Conditions ✅
1. **Reject button EXISTS as `<button>` element** (not `<a>` link)
2. **Reject button is VISIBLE** on first layer without navigation
3. **Same visual hierarchy** as accept button (checked separately in Type C/D)

### Fail Conditions ❌
1. **No reject button** - only "Accept" and "Settings/Manage" link
2. **Reject requires click to second layer** - hidden in settings menu
3. **Reject is `<a>` link** while accept is `<button>` - element type mismatch

### Country-Specific Rules

**Austria (DSB)**
> "Not giving consent should not require more interactions with the consent banner than giving consent."  
**Detection:** Count clicks to reject vs clicks to accept - must be equal

**Germany (DSK)**
> "The option to reject consent must be clearly presented as an equivalent alternative... in particular in terms of size, colour, contrast and typeface."  
**Detection:** Reject button must match accept button styling

**Czech Republic (UOOU)**
> "The reject button for non-essential cookies is placed in the first layer of the consent banner (in the same layer and in a comparable visual design as the accept button)."  
**Detection:** Same layer + comparable visual design

**Ireland (DPC)**
> "If you use a button on the banner with an 'accept' option, you must give equal prominence to an option which allows the user to 'reject' cookies."  
**Detection:** Equal prominence measurement (size, position, styling)

### Real DPA Decision Examples
- **Austria DSB Case C037-11426:** Consent banner with "OK" button in red while "reject cookies" and "settings" as black text links underneath - VIOLATION
- **Germany BlnBDI Case C037-12299:** Accept and reject in different colors acceptable IF "Kommunikationseffekt" (communication effect) is equivalent

---

## TYPE B: Pre-Ticked Boxes

### Legal Basis
- **GDPR:** Article 4(11) - consent requires affirmative action
- **GDPR:** Recital 32 - "Silence, pre-ticked boxes or inactivity should not constitute consent"
- **CJEU:** Planet49 case (C-673/17) - pre-ticked boxes invalid

### Violation Description
Checkboxes for non-essential cookies are pre-selected by default, requiring users to UNTICK to refuse consent.

### Detection Method - Puppeteer

**Check for Pre-Ticked State BEFORE User Interaction**
```javascript
// On page load, BEFORE any user clicks
const preTickedBoxes = await page.$$eval(
  'input[type="checkbox"]:checked',
  checkboxes => checkboxes.map(cb => ({
    id: cb.id,
    name: cb.name,
    checked: cb.checked,
    labels: cb.labels[0]?.innerText
  }))
);
```

**Filter Out Essential Cookies**
```javascript
// Essential/necessary cookies MAY be pre-ticked (not subject to consent)
// Keywords: "necessary", "essential", "strictly necessary", "technical"
const nonEssentialPreTicked = preTickedBoxes.filter(box => {
  const label = box.labels?.toLowerCase() || '';
  return !label.includes('necessary') && 
         !label.includes('essential') &&
         !label.includes('technical');
});
```

### Pass Conditions ✅
1. **All non-essential cookie checkboxes UNCHECKED** by default
2. **User must actively TICK** to grant consent (opt-in)
3. **Essential cookies MAY be pre-ticked** (not subject to consent requirement)

### Fail Conditions ❌
1. **Any non-essential cookie checkbox is PRE-TICKED**
2. **Toggle switches in "ON" position** by default
3. **Radio buttons defaulting to "Accept"** instead of no selection

### Country-Specific Rules

**Austria (DSB)**
> "Privacy by default: the data subject must proactively choose to give consent. Default settings or pre-checked boxes in the consent banner are not permitted."  
**Detection:** ZERO pre-checked boxes for consent

**Belgium (GBA/APD)**
> "Consent is not valid if it is collected by means of a box ticked by default that the user must untick to refuse to give consent."  
**Detection:** Checkboxes must default to unchecked

**Finland (Traficom)**
> "Cookie banners may not include pre-ticked boxes or slide switches in the 'ON' position for non-essential cookies."  
**Detection:** Check both checkboxes AND slide switches

**France (CNIL)**
> "The controller may use sliders, deactivated by default."  
**Detection:** Sliders must be OFF/deactivated initially

### Real DPA Decision Examples
- **Spain AEPD:** €5,000 fine for pre-ticked boxes for marketing cookies

---

## TYPE C: Deceptive Link Design

### Legal Basis
- **GDPR:** Article 5(1)(a) - fairness and transparency
- **GDPR:** Article 4(11) - unambiguous consent
- **EDPB:** Cookie Banner Taskforce - "reject" must not be less prominent

### Violation Description
"Reject" or "Settings" option appears as small text link, while "Accept" is prominent button. Misleads users into believing accept is the only option.

### Detection Method - Puppeteer

**Step 1: Identify Element Types**
```javascript
const acceptElement = await page.$('button:has-text("Accept")');
const rejectElement = await page.$(
  'a:has-text("Reject"), a:has-text("Settings")'
);

const elementTypeMismatch = 
  acceptElement?.tagName === 'BUTTON' && 
  rejectElement?.tagName === 'A';
```

**Step 2: Compare Visual Prominence**
```javascript
const acceptBox = await acceptElement.boundingBox();
const rejectBox = await rejectElement.boundingBox();

// Get computed styles
const acceptStyle = await page.evaluate(el => {
  const style = window.getComputedStyle(el);
  return {
    fontSize: parseInt(style.fontSize),
    fontWeight: style.fontWeight,
    display: style.display,
    backgroundColor: style.backgroundColor
  };
}, acceptElement);

const rejectStyle = await page.evaluate(el => {
  const style = window.getComputedStyle(el);
  return {
    fontSize: parseInt(style.fontSize),
    fontWeight: style.fontWeight,
    display: style.display,
    backgroundColor: style.backgroundColor
  };
}, rejectElement);
```

**Step 3: Calculate Font Size Ratio**
```javascript
const fontSizeRatio = rejectStyle.fontSize / acceptStyle.fontSize;
// If ratio < 0.7 → deceptive (reject is 30%+ smaller)
```

### Pass Conditions ✅
1. **Same element type** - both buttons OR both links
2. **Font size ratio ≥ 0.8** (reject at least 80% size of accept)
3. **Both clearly visible** without scrolling banner text

### Fail Conditions ❌
1. **Element type mismatch** - accept is button, reject is link
2. **Font size ratio < 0.7** - reject is significantly smaller
3. **Reject buried in paragraph text** without visual emphasis
4. **Reject requires scrolling** banner content while accept is immediately visible

### Country-Specific Rules

**Germany (DSK)**
> "The option to reject consent must be clearly presented as an equivalent alternative to the option to give consent."  
**Detection:** Visual equivalence check

**Austria (DSB)**
> "Even an identical button, which is however only visible after scrolling through the text of the banner, while the option to give consent is placed at the beginning of the banner cannot be easily recognised as an equivalent alternative."  
**Detection:** Position matters - both must be visible without scrolling

**Luxembourg (CNPD)**
> "If an 'I accept all' button is present on the first layer, a similar 'I refuse all' button should also be present."  
**Detection:** Symmetry requirement - both buttons or both links

### Real DPA Decision Examples
- **noyb Complaint Pattern:** "Accept" as green button, "Settings" as grey text link underneath - VIOLATION

---

## TYPE D: Deceptive Button Colours

### Legal Basis
- **GDPR:** Article 5(1)(a) - fairness principle
- **GDPR:** Article 4(11) - unambiguous consent (misleading colors = ambiguous)
- **EDPB:** Case-by-case assessment, but "obviously misleading" colors prohibited

### Violation Description
Different colors for accept vs reject buttons where accept is highlighted/prominent (e.g., green "Accept", grey "Reject"), nudging users toward acceptance.

### Detection Method - Puppeteer

**Step 1: Extract Button Colors**
```javascript
const acceptColor = await page.evaluate(el => {
  const style = window.getComputedStyle(el);
  return {
    background: style.backgroundColor,
    text: style.color,
    border: style.borderColor
  };
}, acceptButton);

const rejectColor = await page.evaluate(el => {
  const style = window.getComputedStyle(el);
  return {
    background: style.backgroundColor,
    text: style.color,
    border: style.borderColor
  };
}, rejectButton);
```

**Step 2: Calculate Color Brightness (HSL)**
```javascript
// Convert RGB to HSL brightness
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return l;
}

const acceptBrightness = rgbToHsl(...parseRGB(acceptColor.background));
const rejectBrightness = rgbToHsl(...parseRGB(rejectColor.background));
```

**Step 3: Check for "Positive" vs "Negative" Color Associations**
```javascript
// Green/blue = positive, red/grey = negative associations
const positiveColors = ['green', 'blue', 'primary'];
const negativeColors = ['grey', 'gray', 'disabled'];

const acceptColorName = getColorName(acceptColor.background);
const rejectColorName = getColorName(rejectColor.background);

const colorBias = 
  positiveColors.includes(acceptColorName) && 
  negativeColors.includes(rejectColorName);
```

### Pass Conditions ✅
1. **Identical colors** for accept and reject buttons
2. **Neutral colors** for both (e.g., both blue, both grey with equal saturation)
3. **Similar brightness** (brightness ratio 0.7-1.3)

### Fail Conditions ❌
1. **"Positive" color for accept** (green, bright blue) + **"Negative" for reject** (grey, washed out)
2. **High brightness contrast** - accept is vibrant, reject is dim
3. **Accept has colored background**, reject is transparent/outline only

### Country-Specific Rules

**Czech Republic (UOOU)**
> "The appearance and colour of the buttons should be chosen in such a way that the data subject has an opportunity to freely decide... For example, the 'accept' button should not be significantly larger or significantly more colourful than the 'reject' button."  
**Detection:** Compare size AND color saturation

**France (CNIL)**
> "Controllers ensure that choice collection interfaces do not incorporate potentially misleading design practices... buttons and fonts be of the same size, easy to read, and highlighted in the same way."  
**Detection:** Same highlighting = same visual emphasis

**Luxembourg (CNPD)**
> "Different contrasts of the 'consent buttons' (e.g. the 'I accept' button has a high contrast making it clearly visible, whereas the 'I refuse' button has a very low contrast with the rest of the banner, and is therefore not very visible)."  
**Detection:** Contrast ratio with banner background must be similar for both buttons

**Spain (AEPD)**
> "The colour or contrast of text and buttons shall not be obviously misleading to users, in such a way as to lead to an involuntary consent."  
**Detection:** "Obviously misleading" = common sense test

### Real DPA Decision Examples
- **Austria DSB Case C037-11426:** Red "OK" button vs black text links - VIOLATION
- **Bavaria BayLDA Case C037-11942:** Different colors acceptable IF reject option still "recognisable as such"

### ⚠️ Important Note
EDPB states "case-by-case" analysis required. Automated detection should flag OBVIOUS cases:
- Green accept + grey reject = HIGH RISK
- Same color family (both blue shades) = LOW RISK
- Report should note: "Manual review recommended - color contrast detected"

---

## TYPE E: Deceptive Button Contrast

### Legal Basis
- **GDPR:** Article 5(1)(a) - fairness
- **Combined with Type D** in EDPB Cookie Banner Taskforce Report
- Accessibility standards: WCAG 2.1 contrast ratios

### Violation Description
Contrast between button and background differs significantly, making reject button less visible. Often combined with Type D (color).

### Detection Method - Puppeteer

**Step 1: Get Banner Background Color**
```javascript
const bannerBg = await page.evaluate(banner => {
  return window.getComputedStyle(banner).backgroundColor;
}, bannerElement);
```

**Step 2: Calculate Contrast Ratios**
```javascript
// WCAG 2.1 contrast ratio formula
function getContrastRatio(color1, color2) {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const acceptContrast = getContrastRatio(acceptColor.background, bannerBg);
const rejectContrast = getContrastRatio(rejectColor.background, bannerBg);
```

**Step 3: Compare Ratios**
```javascript
const contrastDifference = acceptContrast / rejectContrast;
// If >1.5x difference → potential violation
```

### Pass Conditions ✅
1. **Similar contrast ratios** (ratio difference < 1.3x)
2. **Both meet WCAG AA** (4.5:1 for normal text, 3:1 for large text)
3. **Visual weight equal** - both stand out from banner

### Fail Conditions ❌
1. **Accept high contrast** (7:1+), **reject low contrast** (2:1 or less)
2. **Contrast ratio difference >1.5x** - accept significantly more visible
3. **Reject blends into banner** background (fails WCAG AA)

### Country-Specific Rules

**Germany (DSK)**
> "The option to reject consent must be clearly presented as an equivalent alternative... in particular in terms of size, colour, contrast and typeface."  
**Detection:** Contrast explicitly mentioned as factor

**Ireland (DPC)**
> "If you use colour schemes for your consent banners... that blend into the overall background of your site, these settings can be hard to navigate, particularly for people with vision impairments."  
**Detection:** Accessibility consideration - both buttons must pass WCAG

**Luxembourg (CNPD)**
> "High contrast making [accept] clearly visible, whereas the [reject] button has a very low contrast with the rest of the banner."  
**Detection:** Contrast differential is the violation

### Implementation Note
Type D and E are often combined - a button can be both wrong color (green vs grey) AND wrong contrast (high vs low). Check both.

---

## TYPE H: "Legitimate Interest" Claimed

### Legal Basis
- **ePrivacy Directive:** Article 5(3) - consent required for non-essential cookies
- **GDPR:** Article 6(1)(f) - legitimate interest NOT applicable for cookie storage
- **EDPB:** Cookie Banner Taskforce - "legitimate interests of the controller" cannot be legal basis for Art. 5(3) ePD

### Violation Description
Cookie banner claims "legitimate interest" as legal basis for non-essential cookies, bypassing consent requirement. This conflates GDPR lawful basis (Art. 6) with ePrivacy consent requirement (Art. 5.3).

### Detection Method - Puppeteer

**Step 1: Scan Banner Text for Keywords**
```javascript
const bannerText = await page.evaluate(banner => {
  return banner.innerText.toLowerCase();
}, bannerElement);

const legitimateInterestMentioned = 
  bannerText.includes('legitimate interest') ||
  bannerText.includes('legitime interesse') || // German
  bannerText.includes('intérêt légitime') ||  // French
  bannerText.includes('interés legítimo');    // Spanish
```

**Step 2: Check Cookie Categories with "Legitimate Interest" Label**
```javascript
// In settings/preferences layer
const cookieCategories = await page.$$eval(
  '[class*="cookie-category"], [class*="consent-category"]',
  categories => categories.map(cat => ({
    name: cat.querySelector('label, .category-name')?.innerText,
    legalBasis: cat.innerText.toLowerCase(),
    hasLegitInterest: cat.innerText.toLowerCase().includes('legitimate interest')
  }))
);

// Filter for NON-essential categories claiming legitimate interest
const violations = cookieCategories.filter(cat => 
  cat.hasLegitInterest && 
  !cat.name.toLowerCase().includes('necessary') &&
  !cat.name.toLowerCase().includes('essential')
);
```

**Step 3: Check for "Object to legitimate interest" Toggles**
```javascript
// Some CMPs show "legitimate interest" with "Object" toggle instead of consent
const objectToggles = await page.$$eval(
  '[data-purpose*="legitimate"], [class*="legitimate-interest"]',
  elements => elements.map(el => ({
    purpose: el.dataset.purpose || el.className,
    toggleType: el.querySelector('input')?.type,
    label: el.innerText
  }))
);
```

### Pass Conditions ✅
1. **NO mention** of "legitimate interest" for cookies requiring consent
2. **Consent toggles ONLY** for non-essential cookies
3. **Legitimate interest MAY appear** for data processing AFTER cookie placement (separate from Art. 5.3)

### Fail Conditions ❌
1. **"Legitimate interest" listed as legal basis** for analytics, marketing, or tracking cookies
2. **"Object to legitimate interest" toggle** instead of consent toggle for non-essential cookies
3. **Mixed messaging** - banner says "we use cookies based on legitimate interest"

### Country-Specific Rules

**Belgium (GBA/APD)**
> "The processing of personal data in connection with the installation and reading of statistical cookies cannot be based on the legitimate interest of the owner of the website or application."  
**Detection:** Even analytics cookies require consent, not legitimate interest

**Czech Republic (UOOU)**
> "An example of a legitimate interest is the processing of personal data for the purposes of first-party analytics... However, if the user does not consent to the storage and reading of non-essential cookies, the operator is not authorized to use these cookies and, logically, subsequent processing... cannot occur."  
**Detection:** Legitimate interest for PROCESSING is separate from consent for STORAGE

### Critical Distinction
- **Cookie STORAGE** (Art. 5.3 ePD) → **Requires consent**
- **Data PROCESSING** (Art. 6 GDPR) → **May use legitimate interest**

The violation occurs when conflating these two legal frameworks.

### Real DPA Decision Examples
- **EDPB Cookie Banner Taskforce:** "The legal basis for the placement/reading of cookies pursuant to Article 5 (3) cannot be the legitimate interests of the controller."

---

## TYPE I: Inaccurately Classified "Essential" Cookies

### Legal Basis
- **ePrivacy Directive:** Article 5(3) - exemption for "strictly necessary" cookies
- **EDPB:** Cookie Banner Taskforce - assessment of "essential" cookies is difficult, burden on controllers to demonstrate
- **CJEU:** Planet49 - exemption applies narrowly

### Violation Description
Cookies classified as "essential" or "strictly necessary" (exempt from consent) when they serve non-essential purposes like analytics, advertising, or personalization.

### Detection Method - Puppeteer

**Step 1: Identify Cookies Marked as Essential**
```javascript
// Check banner's "essential" or "necessary" cookie category
const essentialCookies = await page.evaluate(() => {
  // Find category labeled "essential", "necessary", "technical"
  const essentialCategory = Array.from(document.querySelectorAll(
    '[class*="cookie-category"], [data-category]'
  )).find(cat => {
    const text = cat.innerText.toLowerCase();
    return text.includes('essential') || 
           text.includes('necessary') ||
           text.includes('strictly necessary');
  });
  
  if (!essentialCategory) return [];
  
  // Extract cookie names listed in this category
  return Array.from(essentialCategory.querySelectorAll(
    '[data-cookie-name], .cookie-name, td'
  )).map(el => el.innerText.trim());
});
```

**Step 2: Cross-Reference with Detected Cookies**
```javascript
// Compare declared "essential" cookies with actual detected cookies
const detectedCookies = await page.cookies();

const suspiciousEssential = essentialCookies.filter(declared => {
  const detected = detectedCookies.find(c => c.name === declared);
  if (!detected) return false;
  
  // Known non-essential patterns
  const nonEssentialPatterns = [
    '_ga', '_gid', '_gat',      // Google Analytics
    '_fbp', 'fr',               // Facebook
    '__utm',                    // UTM tracking
    'IDE', 'test_cookie',       // DoubleClick
    '_hjSessionUser',           // Hotjar
    'YSC', 'VISITOR_INFO'       // YouTube
  ];
  
  return nonEssentialPatterns.some(pattern => 
    declared.includes(pattern)
  );
});
```

**Step 3: Check Cookie Purpose Descriptions**
```javascript
// If cookie policy available, check stated purposes
const essentialPurposes = await page.evaluate(cookieNames => {
  // Find purpose descriptions for these cookies
  return cookieNames.map(name => {
    const row = Array.from(document.querySelectorAll('tr, .cookie-row'))
      .find(r => r.innerText.includes(name));
    return {
      name,
      purpose: row?.querySelector('.cookie-purpose, td:nth-child(2)')?.innerText
    };
  });
}, essentialCookies);

// Flag if purpose includes tracking/analytics keywords
const misclassified = essentialPurposes.filter(cookie => {
  const purpose = cookie.purpose?.toLowerCase() || '';
  return purpose.includes('analytics') ||
         purpose.includes('tracking') ||
         purpose.includes('advertising') ||
         purpose.includes('performance monitoring');
});
```

### Pass Conditions ✅
1. **Only genuinely essential cookies** marked as such (session management, security, load balancing)
2. **Purpose descriptions align** with "strictly necessary" definition
3. **No tracking cookies** (analytics, advertising) in essential category

### Fail Conditions ❌
1. **Google Analytics (_ga, _gid)** classified as essential
2. **Facebook Pixel (_fbp)** classified as essential
3. **Third-party advertising cookies** classified as essential
4. **Purpose description contradicts** essential classification (e.g., "used for analytics")

### Country-Specific Rules

**EDPB Cookie Banner Taskforce**
> "The taskforce members agreed that the assessment of cookies to determine which ones are essential raises practical difficulties... The existence of tools to establish the list of cookies used by a website has been discussed, as well as the responsibility of website owners to maintain such lists, and to provide them to the competent authorities where requested and to demonstrate the 'essentiality' of the cookies listed."  
**Detection:** Burden on website owner to PROVE essentiality

**Strict Interpretation - What IS Essential**
- **Session cookies** - maintaining user state during visit
- **Security cookies** - CSRF tokens, authentication
- **Load balancing** - distributing traffic across servers
- **Accessibility** - font size, language preferences

**NOT Essential**
- **Analytics** - even "first-party analytics" (Czech DPA exception is for PROCESSING, not storage)
- **Performance monitoring** - measuring page load times
- **A/B testing** - showing different page versions
- **Personalization** - remembering user preferences beyond session

### Implementation Challenge
This violation requires KNOWLEDGE of what cookies actually do. Automated detection can:
1. **Flag known third-party tracking cookies** (high confidence)
2. **Flag suspicious purpose descriptions** (medium confidence)
3. **Require manual review** for ambiguous cases

### Real DPA Decision Examples
- **Common pattern:** Websites classify Google Analytics as "necessary for website functionality" - VIOLATION

---

## TYPE K: Not as Easy to Withdraw as to Give Consent

### Legal Basis
- **GDPR:** Article 7(3) - "It shall be as easy to withdraw consent as to give it"
- **ePrivacy Directive:** Article 5(3) - applies via GDPR consent standards
- **EDPB Guidelines 05/2020:** Specific guidance on withdrawal mechanisms

### Violation Description
Accepting cookies requires fewer clicks/actions than rejecting them. Example: One-click "Accept All" but rejecting requires navigating to settings, unticking multiple boxes, and confirming.

### Detection Method - Puppeteer

**Step 1: Count Clicks to Accept**
```javascript
let acceptClicks = 0;
const acceptPath = [];

// Scenario: Click "Accept All" button
const acceptButton = await page.$('button:has-text("Accept All")');
if (acceptButton && await acceptButton.isVisible()) {
  acceptClicks = 1;
  acceptPath.push('Click "Accept All" button');
}
```

**Step 2: Count Clicks to Reject**
```javascript
let rejectClicks = 0;
const rejectPath = [];

// Scenario: Click reject (if available on first layer)
const rejectButton = await page.$('button:has-text("Reject All")');
if (rejectButton && await rejectButton.isVisible()) {
  rejectClicks = 1;
  rejectPath.push('Click "Reject All" button');
} else {
  // No reject on first layer - must go to settings
  rejectClicks++;
  rejectPath.push('Click "Settings" or "Manage" button');
  
  await page.click('[data-action="settings"]'); // Example selector
  
  // Check if need to untick boxes
  const checkboxes = await page.$$('input[type="checkbox"]:checked');
  if (checkboxes.length > 0) {
    rejectClicks += checkboxes.length;
    rejectPath.push(`Untick ${checkboxes.length} checkboxes`);
  }
  
  // Click "Save" or "Confirm" button
  rejectClicks++;
  rejectPath.push('Click "Save Preferences" button');
}
```

**Step 3: Compare Click Counts**
```javascript
const clickImbalance = rejectClicks - acceptClicks;
// If clickImbalance > 0 → violation
// Example: Accept = 1 click, Reject = 4 clicks → violation
```

**Step 4: Check for Additional Friction**
```javascript
// Other friction patterns
const frictionChecks = {
  confirmationDialog: await page.$('[role="dialog"]:has-text("Are you sure")'),
  warningMessage: await page.$('.warning:has-text("limited functionality")'),
  delayedButton: await page.evaluate(() => {
    // Check if "Save" button has disabled state initially
    const saveBtn = document.querySelector('[data-action="save"]');
    return saveBtn?.disabled || saveBtn?.classList.contains('disabled');
  })
};
```

### Pass Conditions ✅
1. **Equal number of clicks** - accept in N clicks, reject in N clicks
2. **"Reject All" button** on first layer matching "Accept All"
3. **No confirmation dialogs** or warnings specific to rejection
4. **Immediate action** - no artificial delays on reject path

### Fail Conditions ❌
1. **Click imbalance** - accept requires fewer clicks than reject
2. **Reject buried in settings** - requires navigation to second/third layer
3. **Individual unticking** - must untick 5+ boxes manually to reject all
4. **Confirmation required** - "Are you sure you want to reject?" dialog (but not for accept)
5. **Disabled buttons** - "Save" button greyed out initially on settings page
6. **Warning messages** - "Some features may not work" only shown on reject path

### Country-Specific Rules

**Luxembourg (CNPD)**
> "If it takes several operations (number of clicks or other) to accept a specific purpose, it should not take a greater number of operations to reject it. Similarly, if an 'I accept all' button is present on the first layer, a similar 'I refuse all' button should also be present."  
**Detection:** Count operations (clicks, toggles, confirmations)

**Italy (Garante)**
> "The mechanism to enable continued browsing without giving any consent will have to be as user-friendly and accessible as the one in place for giving one's consent."  
**Detection:** User-friendliness = equal friction

**Germany (DSK)**
> "A 'settings or reject' button, which leads to a further layer of the banner, is not sufficient."  
**Detection:** Reject must NOT require second layer navigation

**Greece (HDPA)**
> "The user should be able, with the same number of actions ('clicks') and from the same level, either to accept the use of the trackers... or to reject it."  
**Detection:** Same level = first layer

### Real DPA Decision Examples
- **Google €150M fine (CNIL):** Required multiple clicks to reject cookies while offering one-click acceptance

### Implementation Priority
This is one of the MOST COMMON violations. Automated detection should:
1. Always simulate both accept and reject paths
2. Count every click, toggle, and confirmation
3. Flag ANY imbalance (even 1 extra click is non-compliant)

---

## DETECTION WORKFLOW - Integration Plan

### Phase 1: Banner Identification
```javascript
async function findCookieBanner(page) {
  // Wait for banner to appear (max 5 seconds)
  await page.waitForSelector('[id*="cookie"], [class*="consent"]', {
    timeout: 5000
  }).catch(() => null);
  
  // Return banner element or null
  return await page.$('[id*="cookie"]');
}
```

### Phase 2: Run All 8 Checks
```javascript
async function auditCookieBanner(page) {
  const banner = await findCookieBanner(page);
  if (!banner) return { detected: false };
  
  const violations = {
    typeA: await checkTypeA(page, banner),
    typeB: await checkTypeB(page, banner),
    typeC: await checkTypeC(page, banner),
    typeD: await checkTypeD(page, banner),
    typeE: await checkTypeE(page, banner),
    typeH: await checkTypeH(page, banner),
    typeI: await checkTypeI(page),      // Requires cookie detection
    typeK: await checkTypeK(page, banner)
  };
  
  return violations;
}
```

### Phase 3: Country-Specific Adjustments
```javascript
function applyCountryRules(violations, jurisdiction) {
  // Example: Austria is strictest on Type A
  if (jurisdiction === 'AT') {
    if (violations.typeA.clickImbalance > 0) {
      violations.typeA.severity = 'critical';
    }
  }
  
  // Germany accepts color differences IF "Kommunikationseffekt" is equal
  if (jurisdiction === 'DE' && violations.typeD.detected) {
    violations.typeD.requiresManualReview = true;
  }
  
  return violations;
}
```

### Phase 4: Generate Report
```javascript
{
  "bannerDetected": true,
  "violations": {
    "typeA": {
      "detected": true,
      "severity": "critical",
      "description": "No reject button on first layer",
      "evidence": {
        "rejectButtonExists": false,
        "requiresSecondLayer": true
      },
      "dpaPrecedents": ["Austria DSB C037-11426"]
    },
    "typeB": {
      "detected": false
    },
    // ... etc for all 8 types
  },
  "overallCompliance": "non-compliant",
  "criticalViolations": 2,
  "jurisdiction": "AT"
}
```

---

## COUNTRY-SPECIFIC ENFORCEMENT SUMMARY

| Country | Strictest On | Notable Position |
|---------|-------------|------------------|
| **Austria** | Type A, Type K | No extra clicks to reject |
| **Germany** | Type C | Element type must match |
| **France** | Type B, Type K | Pre-ticked boxes explicitly banned |
| **Luxembourg** | Type K | Symmetry principle - equal operations |
| **Czech Republic** | Type D | Color AND size must not differ significantly |
| **Spain** | Type E | Contrast must not mislead |
| **Belgium** | Type H | Legitimate interest NOT valid for cookies |
| **Italy** | Type K | User-friendliness must be equal |

---

## TESTING CHECKLIST FOR CLAUDE CODE

Before deploying detection system, validate against:

### Test Site Requirements
1. **Compliant banner** - OneTrust/Cookiebot with "Accept All" AND "Reject All" on first layer
2. **Type A violator** - Banner with only "Accept" and "Settings" link
3. **Type B violator** - Pre-ticked checkboxes for marketing cookies
4. **Type K violator** - One-click accept, 3+ clicks to reject

### Validation Criteria
- ✅ **Detect 100% of known violations** on test sites
- ✅ **Zero false positives** on compliant banners
- ✅ **Evidence collection** - screenshots, DOM snapshots for manual review
- ✅ **Country rules applied** correctly based on jurisdiction input

---

## IMPLEMENTATION PRIORITY

**Phase 1 (Must Have):**
1. Type A - No reject button (most common)
2. Type K - Asymmetric clicks (second most common)
3. Type B - Pre-ticked boxes (clear-cut violation)

**Phase 2 (Should Have):**
4. Type C - Link vs button (element type check)
5. Type D - Deceptive colors (requires color analysis)

**Phase 3 (Enhancement):**
6. Type E - Contrast (accessibility check)
7. Type H - Legitimate interest (text analysis)
8. Type I - Misclassified essential (requires cookie purpose knowledge)

---

## NOTES FOR AI IMPLEMENTATION

1. **Type I is hardest** - requires external knowledge of cookie purposes. Recommend:
   - Database of known tracking cookies (Google Analytics, Facebook Pixel, etc.)
   - Flag for manual review if ambiguous

2. **Types D & E overlap** - can combine into single "visual prominence" check

3. **Country rules** - store in separate JSON, apply as multiplier/adjustment to base detection

4. **Evidence preservation** - save screenshots, DOM snapshots for each detected violation

5. **Manual review flags** - when automated detection is uncertain (e.g., subtle color differences), flag for human review

---

**END OF DETECTION GUIDE**

This guide is ready for implementation in `/backend/src/analyzers/cookie-banner-checker.js`
