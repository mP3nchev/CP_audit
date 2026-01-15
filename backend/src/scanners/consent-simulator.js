/**
 * Consent Simulator - Accept/Reject Scenario Testing
 *
 * Simulates user interactions with cookie banners to detect GDPR violations:
 * - Scenario 1: User rejects all cookies
 * - Scenario 2: User accepts all cookies
 * - Comparison: What cookies loaded in each scenario
 */

const {
  launchBrowser,
  createPage,
  navigateToUrl,
  waitForPageStability,
  closeBrowser
} = require('./puppeteer-setup');

const {
  extractCookies,
  getCookieStats
} = require('./cookie-extractor');

/**
 * Find cookie banner buttons
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Banner buttons found
 */
async function findBannerButtons(page) {
  return await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a'));

    // Find Accept button
    const acceptButton = buttons.find(b => {
      const text = b.textContent.toLowerCase();
      return text.includes('accept all') ||
             text.includes('accept') ||
             text.includes('agree') ||
             text.includes('allow all') ||
             b.getAttribute('data-action')?.includes('accept');
    });

    // Find Reject button
    const rejectButton = buttons.find(b => {
      const text = b.textContent.toLowerCase();
      return text.includes('reject all') ||
             text.includes('reject') ||
             text.includes('decline') ||
             text.includes('deny') ||
             b.getAttribute('data-action')?.includes('reject');
    });

    // Find Settings button
    const settingsButton = buttons.find(b => {
      const text = b.textContent.toLowerCase();
      return text.includes('settings') ||
             text.includes('customize') ||
             text.includes('manage') ||
             text.includes('preferences');
    });

    return {
      acceptButton: acceptButton ? {
        text: acceptButton.textContent.trim(),
        selector: acceptButton.id ? `#${acceptButton.id}` :
                 acceptButton.className ? `.${acceptButton.classList[0]}` : 'button',
        visible: true
      } : null,
      rejectButton: rejectButton ? {
        text: rejectButton.textContent.trim(),
        selector: rejectButton.id ? `#${rejectButton.id}` :
                 rejectButton.className ? `.${rejectButton.classList[0]}` : 'button',
        visible: true
      } : null,
      settingsButton: settingsButton ? {
        text: settingsButton.textContent.trim(),
        selector: settingsButton.id ? `#${settingsButton.id}` :
                 settingsButton.className ? `.${settingsButton.classList[0]}` : 'button',
        visible: true
      } : null
    };
  });
}

/**
 * Extract cookies from multiple sources
 * Checks: page.cookies(), localStorage, sessionStorage, network Set-Cookie headers
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} All cookies from all sources
 */
async function extractAllCookies(page) {
  // 1. Standard cookies via CDP
  const cdpCookies = await page.cookies();

  // 2. Cookies from all frames (including iframes)
  const frames = page.frames();
  let frameCookies = [];
  for (const frame of frames) {
    try {
      const cookies = await frame.evaluate(() => document.cookie);
      if (cookies) {
        const parsed = cookies.split(';').map(c => {
          const [name, ...valueParts] = c.trim().split('=');
          return { name, value: valueParts.join('='), source: 'frame' };
        });
        frameCookies.push(...parsed);
      }
    } catch (e) {
      // Frame may not be accessible (CORS)
    }
  }

  // 3. Storage API cookies
  const storageCookies = await page.evaluate(() => {
    const storage = {
      localStorage: [],
      sessionStorage: []
    };

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        storage.localStorage.push({
          name: key,
          value: localStorage.getItem(key),
          source: 'localStorage'
        });
      }
    } catch (e) {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        storage.sessionStorage.push({
          name: key,
          value: sessionStorage.getItem(key),
          source: 'sessionStorage'
        });
      }
    } catch (e) {}

    return storage;
  });

  // 4. Wait additional time for delayed cookies
  await page.waitForTimeout(3000);
  const delayedCookies = await page.cookies();

  // Combine and deduplicate
  const allCookiesMap = new Map();

  // Add CDP cookies
  cdpCookies.forEach(c => allCookiesMap.set(c.name, { ...c, source: 'http' }));
  delayedCookies.forEach(c => allCookiesMap.set(c.name, { ...c, source: 'http' }));

  // Add frame cookies (if not already present)
  frameCookies.forEach(c => {
    if (!allCookiesMap.has(c.name)) {
      allCookiesMap.set(c.name, c);
    }
  });

  // Add storage items (as cookies for analysis)
  storageCookies.localStorage.forEach(c => {
    allCookiesMap.set(`ls:${c.name}`, c);
  });
  storageCookies.sessionStorage.forEach(c => {
    allCookiesMap.set(`ss:${c.name}`, c);
  });

  return Array.from(allCookiesMap.values());
}

/**
 * Click button and handle possible navigation/overlay changes
 * @param {Page} page - Puppeteer page
 * @param {string} text - Button text to find
 * @returns {Promise<boolean>} Success
 */
async function clickButton(page, text) {
  try {
    await page.evaluate((buttonText) => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const target = buttons.find(b =>
        b.textContent.toLowerCase().includes(buttonText.toLowerCase())
      );
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, text);

    // Wait for any animations/changes
    await page.waitForTimeout(1000);
    return true;
  } catch (error) {
    console.error(`Failed to click button "${text}":`, error.message);
    return false;
  }
}

/**
 * Run Reject All scenario
 * @param {string} websiteUrl - URL to test
 * @returns {Promise<Object>} Reject scenario results
 */
async function runRejectScenario(websiteUrl) {
  const startTime = Date.now();
  let browser = null;

  try {
    console.log('');
    console.log('🚫 === REJECT SCENARIO ===');
    console.log(`   Testing: ${websiteUrl}`);

    // Launch browser
    browser = await launchBrowser();
    const page = await createPage(browser);

    // Extract cookies BEFORE navigation
    const cookiesBeforeLoad = await page.cookies();

    // Navigate to site
    await navigateToUrl(page, websiteUrl);
    await waitForPageStability(page, 2000);

    // Extract cookies BEFORE any interaction
    const cookiesBeforeConsent = await extractAllCookies(page);

    // Find banner buttons
    const buttons = await findBannerButtons(page);

    let clickPath = [];
    let clickCount = 0;

    // Try to reject
    if (buttons.rejectButton) {
      // Direct reject button exists
      console.log(`   ✅ Found "Reject" button: "${buttons.rejectButton.text}"`);
      await clickButton(page, buttons.rejectButton.text);
      clickPath.push('Click Reject All');
      clickCount = 1;
    } else if (buttons.settingsButton) {
      // Must go through settings
      console.log(`   ⚠️  No direct Reject - using Settings`);
      await clickButton(page, buttons.settingsButton.text);
      clickPath.push('Click Settings');
      clickCount++;

      // Wait for settings panel
      await page.waitForTimeout(1000);

      // Try to find "Reject All" in settings
      const settingsButtons = await findBannerButtons(page);
      if (settingsButtons.rejectButton) {
        await clickButton(page, settingsButtons.rejectButton.text);
        clickPath.push('Click Reject All in settings');
        clickCount++;
      } else {
        // Must untick checkboxes
        const unticked = await page.evaluate(() => {
          const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));
          let count = 0;
          checkboxes.forEach(cb => {
            // Don't untick "necessary" cookies
            const label = cb.labels?.[0]?.textContent.toLowerCase() || '';
            if (!label.includes('necessary') && !label.includes('essential')) {
              cb.click();
              count++;
            }
          });
          return count;
        });

        if (unticked > 0) {
          clickPath.push(`Untick ${unticked} checkboxes`);
          clickCount += unticked;
        }

        // Click Save/Confirm
        await clickButton(page, 'save');
        clickPath.push('Click Save Preferences');
        clickCount++;
      }
    } else {
      console.log(`   ❌ No Reject or Settings button found`);
    }

    // Wait for consent to be processed
    await page.waitForTimeout(2000);

    // Extract cookies AFTER rejecting
    const cookiesAfterReject = await extractAllCookies(page);

    // Close browser
    await closeBrowser(browser);

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`   📊 Reject scenario completed in ${duration}s`);
    console.log(`   🍪 Cookies before consent: ${cookiesBeforeConsent.length}`);
    console.log(`   🍪 Cookies after reject: ${cookiesAfterReject.length}`);
    console.log(`   🖱️  Clicks required: ${clickCount}`);
    console.log(`   📍 Path: ${clickPath.join(' → ')}`);

    return {
      scenario: 'reject',
      success: true,
      cookiesBeforeConsent: cookiesBeforeConsent,
      cookiesAfterConsent: cookiesAfterReject,
      clickCount: clickCount,
      clickPath: clickPath,
      buttons: buttons,
      duration: duration
    };

  } catch (error) {
    console.error(`   ❌ Reject scenario failed:`, error.message);
    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }

    return {
      scenario: 'reject',
      success: false,
      error: error.message,
      cookiesBeforeConsent: [],
      cookiesAfterConsent: [],
      clickCount: 0,
      clickPath: []
    };
  }
}

/**
 * Run Accept All scenario
 * @param {string} websiteUrl - URL to test
 * @returns {Promise<Object>} Accept scenario results
 */
async function runAcceptScenario(websiteUrl) {
  const startTime = Date.now();
  let browser = null;

  try {
    console.log('');
    console.log('✅ === ACCEPT SCENARIO ===');
    console.log(`   Testing: ${websiteUrl}`);

    // Launch NEW browser (separate context)
    browser = await launchBrowser();
    const page = await createPage(browser);

    // Navigate to site
    await navigateToUrl(page, websiteUrl);
    await waitForPageStability(page, 2000);

    // Extract cookies BEFORE any interaction
    const cookiesBeforeConsent = await extractAllCookies(page);

    // Find banner buttons
    const buttons = await findBannerButtons(page);

    let clickPath = [];
    let clickCount = 0;

    // Try to accept
    if (buttons.acceptButton) {
      console.log(`   ✅ Found "Accept" button: "${buttons.acceptButton.text}"`);
      await clickButton(page, buttons.acceptButton.text);
      clickPath.push('Click Accept All');
      clickCount = 1;
    } else {
      console.log(`   ❌ No Accept button found`);
    }

    // Wait for consent to be processed and cookies to load
    await page.waitForTimeout(3000);

    // Extract cookies AFTER accepting
    const cookiesAfterAccept = await extractAllCookies(page);

    // Close browser
    await closeBrowser(browser);

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`   📊 Accept scenario completed in ${duration}s`);
    console.log(`   🍪 Cookies before consent: ${cookiesBeforeConsent.length}`);
    console.log(`   🍪 Cookies after accept: ${cookiesAfterAccept.length}`);
    console.log(`   🖱️  Clicks required: ${clickCount}`);
    console.log(`   📍 Path: ${clickPath.join(' → ')}`);

    return {
      scenario: 'accept',
      success: true,
      cookiesBeforeConsent: cookiesBeforeConsent,
      cookiesAfterConsent: cookiesAfterAccept,
      clickCount: clickCount,
      clickPath: clickPath,
      buttons: buttons,
      duration: duration
    };

  } catch (error) {
    console.error(`   ❌ Accept scenario failed:`, error.message);
    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }

    return {
      scenario: 'accept',
      success: false,
      error: error.message,
      cookiesBeforeConsent: [],
      cookiesAfterConsent: [],
      clickCount: 0,
      clickPath: []
    };
  }
}

/**
 * Compare Accept vs Reject scenarios
 * @param {Object} rejectResults - Reject scenario results
 * @param {Object} acceptResults - Accept scenario results
 * @returns {Object} Comparison analysis
 */
function compareScenarios(rejectResults, acceptResults) {
  console.log('');
  console.log('📊 === SCENARIO COMPARISON ===');

  // Click imbalance (GDPR Article 7(3) violation)
  const clickImbalance = rejectResults.clickCount - acceptResults.clickCount;
  const clickViolation = clickImbalance > 0;

  console.log(`   Accept clicks: ${acceptResults.clickCount}`);
  console.log(`   Reject clicks: ${rejectResults.clickCount}`);
  console.log(`   Imbalance: ${clickImbalance} extra clicks to reject`);
  console.log(`   ⚠️  GDPR Art. 7(3) violation: ${clickViolation ? 'YES' : 'NO'}`);

  // Cookies loaded before consent (tracking before consent)
  const cookiesBeforeConsent = rejectResults.cookiesBeforeConsent.filter(c =>
    !c.name.startsWith('_') || c.name.includes('_ga') || c.name.includes('_fb')
  );
  console.log(`   🍪 Cookies before consent: ${cookiesBeforeConsent.length}`);

  // Cookies in Reject scenario (should be minimal)
  const cookiesAfterReject = rejectResults.cookiesAfterConsent;
  const trackingCookiesInReject = cookiesAfterReject.filter(c =>
    c.name.includes('_ga') || c.name.includes('_gid') ||
    c.name.includes('_fbp') || c.name.includes('_hjid') ||
    c.name.includes('doubleclick') || c.name.includes('_utm')
  );

  console.log(`   🍪 Tracking cookies after REJECT: ${trackingCookiesInReject.length}`);
  if (trackingCookiesInReject.length > 0) {
    console.log(`   ⚠️  VIOLATION: Tracking cookies present after rejection!`);
    trackingCookiesInReject.forEach(c => {
      console.log(`      - ${c.name} (${c.domain || c.source})`);
    });
  }

  // Cookies in Accept scenario
  const cookiesAfterAccept = acceptResults.cookiesAfterConsent;
  console.log(`   🍪 Cookies after ACCEPT: ${cookiesAfterAccept.length}`);

  // Cookie difference (Accept should have MORE than Reject)
  const cookieDifference = cookiesAfterAccept.length - cookiesAfterReject.length;
  console.log(`   📈 Cookie increase (Accept vs Reject): ${cookieDifference}`);

  if (cookieDifference <= 0) {
    console.log(`   ⚠️  SUSPICIOUS: No difference between Accept and Reject!`);
  }

  // Violations summary
  const violations = [];

  if (clickViolation) {
    violations.push({
      type: 'click_imbalance',
      severity: 'critical',
      description: `Reject requires ${clickImbalance} more clicks than Accept`,
      legal_basis: 'GDPR Article 7(3) - Withdrawal must be as easy as giving consent'
    });
  }

  if (trackingCookiesInReject.length > 0) {
    violations.push({
      type: 'tracking_after_reject',
      severity: 'critical',
      description: `${trackingCookiesInReject.length} tracking cookies found after rejection`,
      cookies: trackingCookiesInReject.map(c => c.name),
      legal_basis: 'ePrivacy Directive Article 5(3) - Consent required for non-essential cookies'
    });
  }

  if (cookieDifference <= 0) {
    violations.push({
      type: 'no_consent_effect',
      severity: 'high',
      description: 'Accept and Reject produce same cookies - consent mechanism ineffective',
      legal_basis: 'GDPR Article 4(11) - Consent must have real effect'
    });
  }

  console.log('');
  console.log(`   Total violations: ${violations.length}`);
  console.log('═══════════════════════════════════════════════════════');

  return {
    clickImbalance: clickImbalance,
    clickViolation: clickViolation,
    cookiesBeforeConsent: cookiesBeforeConsent.length,
    cookiesAfterReject: cookiesAfterReject.length,
    cookiesAfterAccept: cookiesAfterAccept.length,
    trackingCookiesInReject: trackingCookiesInReject.length,
    cookieDifference: cookieDifference,
    violations: violations,
    rejectPath: rejectResults.clickPath,
    acceptPath: acceptResults.clickPath
  };
}

/**
 * Run full consent simulation (both scenarios)
 * @param {string} websiteUrl - URL to test
 * @returns {Promise<Object>} Full simulation results
 */
async function runConsentSimulation(websiteUrl) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('🎭 CONSENT SIMULATION - Accept vs Reject');
  console.log('═══════════════════════════════════════════════════════');

  const startTime = Date.now();

  // Run Reject scenario first (to avoid Accept contaminating results)
  const rejectResults = await runRejectScenario(websiteUrl);

  // Run Accept scenario in clean browser
  const acceptResults = await runAcceptScenario(websiteUrl);

  // Compare results
  const comparison = compareScenarios(rejectResults, acceptResults);

  const totalDuration = Math.round((Date.now() - startTime) / 1000);

  return {
    websiteUrl: websiteUrl,
    rejectScenario: rejectResults,
    acceptScenario: acceptResults,
    comparison: comparison,
    totalDuration: totalDuration
  };
}

module.exports = {
  runConsentSimulation,
  runRejectScenario,
  runAcceptScenario,
  compareScenarios,
  extractAllCookies,
  findBannerButtons
};
