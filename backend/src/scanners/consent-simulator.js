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
 * Wait for consent UI to be ready (STATE-BASED, not lifecycle-based)
 * @param {Page} page - Puppeteer page
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<boolean>} True if consent UI is ready
 */
async function waitForConsentUIReady(page, timeout = 30000) {
  const startTime = Date.now();

  console.log(`   🎯 Waiting for consent UI state (max ${timeout}ms)...`);

  while (Date.now() - startTime < timeout) {
    try {
      // STATE CHECK: Is consent UI rendered and interactive?
      const uiState = await page.evaluate(() => {
        // CMP-specific markers
        const cmpMarkers = [
          '#cookiescript_injected',           // CookieScript loaded
          '#onetrust-banner-sdk',             // OneTrust banner
          '#CybotCookiebotDialog',            // Cookiebot dialog
          '[data-testid="uc-privacy-banner"]' // Usercentrics
        ];

        for (const marker of cmpMarkers) {
          const element = document.querySelector(marker);
          if (element) {
            const style = window.getComputedStyle(element);
            if (style.display !== 'none') {
              return { ready: true, cmp: marker, reason: 'CMP UI detected' };
            }
          }
        }

        // Generic consent UI detection
        const consentElements = document.querySelectorAll(
          '[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"], [role="dialog"]'
        );

        for (const el of consentElements) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);

          if (
            rect.width > 200 &&
            rect.height > 100 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          ) {
            // Check if it has buttons
            const buttons = el.querySelectorAll('button, a, [role="button"]');
            if (buttons.length >= 1) {
              return { ready: true, cmp: 'generic', reason: 'Consent UI with buttons detected' };
            }
          }
        }

        return { ready: false, reason: 'No consent UI found' };
      });

      if (uiState.ready) {
        console.log(`   ✅ Consent UI ready: ${uiState.reason} (${uiState.cmp})`);
        return true;
      }

      // Poll every 500ms
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.log(`   ⚠️  UI state check failed: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`   ⚠️  Consent UI not ready after ${timeout}ms`);
  return false;
}

/**
 * Wait for consent state transition (STATE-BASED)
 * @param {Page} page - Puppeteer page
 * @param {string} expectedTransition - 'accept' or 'reject'
 * @param {number} timeout - Max wait time
 * @returns {Promise<boolean>} True if transition completed
 */
async function waitForConsentTransition(page, expectedTransition, timeout = 15000) {
  const startTime = Date.now();

  console.log(`   🎯 Waiting for consent transition: ${expectedTransition}...`);

  while (Date.now() - startTime < timeout) {
    try {
      const transitionState = await page.evaluate(() => {
        // Check if consent storage has been set
        const consentKeys = [
          'CookieScriptConsent',
          'OptanonConsent',
          'CookieConsent',
          'cookieConsent'
        ];

        for (const key of consentKeys) {
          const lsValue = localStorage.getItem(key);
          const cookieValue = document.cookie.split(';').find(c => c.trim().startsWith(key));

          if (lsValue || cookieValue) {
            return { transitioned: true, reason: `Consent stored: ${key}` };
          }
        }

        // Check if banner disappeared
        const bannerVisible = Array.from(
          document.querySelectorAll('[id*="cookie"], [class*="cookie"]')
        ).some(el => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && rect.height > 100;
        });

        if (!bannerVisible) {
          return { transitioned: true, reason: 'Banner disappeared' };
        }

        return { transitioned: false, reason: 'No transition detected' };
      });

      if (transitionState.transitioned) {
        console.log(`   ✅ Consent transition completed: ${transitionState.reason}`);
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`   ⚠️  Consent transition not detected after ${timeout}ms`);
  return false;
}

/**
 * Find cookie banner buttons (supports CookieScript, OneTrust, Cookiebot, Usercentrics)
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Banner buttons found
 */
async function findBannerButtons(page) {
  return await page.evaluate(() => {
    // Helper: Generate selector for element
    function getSelector(element) {
      if (!element) return null;
      if (element.id) return `#${element.id}`;
      if (element.className && typeof element.className === 'string') {
        const classes = element.className.split(' ').filter(c => c.trim());
        if (classes.length > 0) return `.${classes[0]}`;
      }
      return element.tagName.toLowerCase();
    }

    // Helper: Check if element is visible
    function isVisible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    // CMP-SPECIFIC SELECTORS (priority order)
    const cmpSelectors = {
      // CookieScript
      cookieScript: {
        accept: '#cookiescript_accept',
        reject: '#cookiescript_reject',
        settings: '#cookiescript_manage'
      },
      // OneTrust
      oneTrust: {
        accept: '#onetrust-accept-btn-handler',
        reject: '#onetrust-reject-all-handler',
        settings: '#onetrust-pc-btn-handler'
      },
      // Cookiebot
      cookiebot: {
        accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        reject: '#CybotCookiebotDialogBodyButtonDecline',
        settings: '#CybotCookiebotDialogBodyLevelButtonLevelOptinCustom'
      },
      // Usercentrics
      usercentrics: {
        accept: '[data-testid="uc-accept-all-button"]',
        reject: '[data-testid="uc-deny-all-button"]',
        settings: '[data-testid="uc-more-button"]'
      },
      // Complianz
      complianz: {
        accept: '.cmplz-accept',
        reject: '.cmplz-deny',
        settings: '.cmplz-manage-consent'
      }
    };

    let acceptButton = null;
    let rejectButton = null;
    let settingsButton = null;

    // TRY CMP-SPECIFIC SELECTORS FIRST
    for (const [cmpName, selectors] of Object.entries(cmpSelectors)) {
      const accept = document.querySelector(selectors.accept);
      const reject = document.querySelector(selectors.reject);
      const settings = document.querySelector(selectors.settings);

      if (accept && isVisible(accept)) {
        console.log(`[findBannerButtons] Detected ${cmpName} platform`);
        acceptButton = accept;
        rejectButton = reject && isVisible(reject) ? reject : null;
        settingsButton = settings && isVisible(settings) ? settings : null;
        break; // Found CMP, stop searching
      }
    }

    // FALLBACK: Generic text-based search
    if (!acceptButton) {
      const allButtons = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));

      // Find Accept button
      acceptButton = allButtons.find(b => {
        if (!isVisible(b)) return false;
        const text = b.textContent.toLowerCase();
        const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
        const dataAction = (b.getAttribute('data-action') || '').toLowerCase();

        return text.includes('accept all') ||
               text.includes('allow all') ||
               text.includes('agree') ||
               (text.includes('accept') && !text.includes('reject')) ||
               ariaLabel.includes('accept') ||
               dataAction.includes('accept');
      });

      // Find Reject button
      rejectButton = allButtons.find(b => {
        if (!isVisible(b)) return false;
        const text = b.textContent.toLowerCase();
        const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
        const dataAction = (b.getAttribute('data-action') || '').toLowerCase();

        return text.includes('reject all') ||
               text.includes('deny all') ||
               text.includes('decline all') ||
               (text.includes('reject') && !text.includes('accept')) ||
               ariaLabel.includes('reject') ||
               dataAction.includes('reject');
      });

      // Find Settings button
      settingsButton = allButtons.find(b => {
        if (!isVisible(b)) return false;
        const text = b.textContent.toLowerCase();
        const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();

        return text.includes('settings') ||
               text.includes('customize') ||
               text.includes('manage') ||
               text.includes('preferences') ||
               text.includes('options') ||
               ariaLabel.includes('settings');
      });
    }

    return {
      acceptButton: acceptButton ? {
        text: acceptButton.textContent.trim(),
        selector: getSelector(acceptButton),
        visible: true,
        element: acceptButton
      } : null,
      rejectButton: rejectButton ? {
        text: rejectButton.textContent.trim(),
        selector: getSelector(rejectButton),
        visible: true,
        element: rejectButton
      } : null,
      settingsButton: settingsButton ? {
        text: settingsButton.textContent.trim(),
        selector: getSelector(settingsButton),
        visible: true,
        element: settingsButton
      } : null
    };
  });
}

/**
 * Extract cookies from multiple sources (USES CDP Network.getAllCookies for accuracy)
 * Checks: CDP Network.getAllCookies(), document.cookie, localStorage, sessionStorage
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Array>} All cookies from all sources
 */
async function extractAllCookies(page) {
  // WAIT 3 SECONDS for async cookies to load (GA, Facebook Pixel, etc.)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 1. CDP Network.getAllCookies() - MOST COMPREHENSIVE (includes HttpOnly, Secure, all domains)
  let cdpCookies = [];
  try {
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');
    cdpCookies = cookies.map(c => ({ ...c, source: 'cdp' }));
    await client.detach();
  } catch (error) {
    console.warn(`⚠️  CDP getAllCookies failed: ${error.message}`);
  }

  // 2. document.cookie - catches JS-only cookies that CDP might miss
  const documentCookies = await page.evaluate(() => {
    const cookieStr = document.cookie;
    if (!cookieStr) return [];

    return cookieStr.split(';').map(c => {
      const [name, ...valueParts] = c.trim().split('=');
      return {
        name: name.trim(),
        value: valueParts.join('=').trim(),
        domain: window.location.hostname,
        path: '/',
        source: 'document.cookie'
      };
    });
  });

  // 3. Cookies from all frames (including iframes)
  const frames = page.frames();
  let frameCookies = [];
  for (const frame of frames) {
    try {
      const cookies = await frame.evaluate(() => document.cookie);
      if (cookies) {
        const parsed = cookies.split(';').map(c => {
          const [name, ...valueParts] = c.trim().split('=');
          return {
            name: name.trim(),
            value: valueParts.join('=').trim(),
            source: 'iframe'
          };
        });
        frameCookies.push(...parsed);
      }
    } catch (e) {
      // Frame may not be accessible (CORS)
    }
  }

  // 4. Storage API (localStorage, sessionStorage)
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

  // COMBINE AND DEDUPLICATE (CDP is authoritative source)
  const allCookiesMap = new Map();

  // CDP cookies are most reliable - add them first
  cdpCookies.forEach(c => {
    allCookiesMap.set(c.name, c);
  });

  // Add document.cookie items if not already in CDP
  documentCookies.forEach(c => {
    if (!allCookiesMap.has(c.name)) {
      allCookiesMap.set(c.name, c);
    }
  });

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
 * Wait for consent state change using race condition strategy
 * Listens for multiple signals: DOM changes, cookie changes, localStorage, navigation
 * @param {Page} page - Puppeteer page
 * @param {number} timeout - Max wait time in milliseconds (default: 15000)
 * @returns {Promise<string>} What triggered completion
 */
async function waitForConsentStateChange(page, timeout = 15000) {
  try {
    const result = await Promise.race([
      // Strategy 1: DOM mutation observer on consent elements
      page.evaluate(() => {
        return new Promise((resolve) => {
          const observer = new MutationObserver((mutations) => {
            // Check if banner disappeared or consent state changed
            const banner = document.querySelector('[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"]');
            if (!banner || window.getComputedStyle(banner).display === 'none') {
              observer.disconnect();
              resolve('DOM_MUTATION');
            }
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
          });

          // Auto-disconnect after 30s to prevent memory leaks
          setTimeout(() => {
            observer.disconnect();
            resolve('DOM_TIMEOUT');
          }, 30000);
        });
      }),

      // Strategy 2: Cookie change detection
      page.evaluate(() => {
        return new Promise((resolve) => {
          const initialCookies = document.cookie;
          const interval = setInterval(() => {
            if (document.cookie !== initialCookies) {
              clearInterval(interval);
              resolve('COOKIE_CHANGE');
            }
          }, 100);

          setTimeout(() => {
            clearInterval(interval);
            resolve('COOKIE_TIMEOUT');
          }, 30000);
        });
      }),

      // Strategy 3: LocalStorage/SessionStorage change (for CMP platforms like OneTrust, Cookiebot)
      page.evaluate(() => {
        return new Promise((resolve) => {
          const checkStorage = () => {
            // Check common CMP storage keys
            const consentKeys = ['OptanonConsent', 'CookieConsent', 'cookieConsent', 'userConsent', 'consent'];
            for (const key of consentKeys) {
              if (localStorage.getItem(key) || sessionStorage.getItem(key)) {
                resolve('STORAGE_CHANGE');
                return true;
              }
            }
            return false;
          };

          if (checkStorage()) return;

          // Listen for storage events
          window.addEventListener('storage', () => {
            if (checkStorage()) return;
          });

          // Poll for storage changes (some CMPs don't fire storage events)
          const interval = setInterval(() => {
            if (checkStorage()) clearInterval(interval);
          }, 200);

          setTimeout(() => {
            clearInterval(interval);
            resolve('STORAGE_TIMEOUT');
          }, 30000);
        });
      }),

      // Strategy 4: postMessage events (modern CMP platforms)
      page.evaluate(() => {
        return new Promise((resolve) => {
          const handler = (event) => {
            const data = event.data;
            if (data && typeof data === 'object') {
              // Check for consent-related messages
              const dataStr = JSON.stringify(data).toLowerCase();
              if (dataStr.includes('consent') || dataStr.includes('cookie')) {
                window.removeEventListener('message', handler);
                resolve('POST_MESSAGE');
              }
            }
          };

          window.addEventListener('message', handler);

          setTimeout(() => {
            window.removeEventListener('message', handler);
            resolve('MESSAGE_TIMEOUT');
          }, 30000);
        });
      }),

      // Strategy 5: Custom events (some CMPs dispatch custom events)
      page.evaluate(() => {
        return new Promise((resolve) => {
          const eventNames = ['consent', 'cookieConsent', 'consentUpdate', 'OneTrustGroupsUpdated'];
          const handler = () => resolve('CUSTOM_EVENT');

          eventNames.forEach(name => {
            window.addEventListener(name, handler, { once: true });
          });

          setTimeout(() => {
            eventNames.forEach(name => {
              window.removeEventListener(name, handler);
            });
            resolve('EVENT_TIMEOUT');
          }, 30000);
        });
      }),

      // Strategy 6: Timeout (safety net)
      new Promise((resolve) => setTimeout(() => resolve('HARD_TIMEOUT'), timeout))
    ]);

    return result;
  } catch (error) {
    console.log(`⚠️  Consent state change detection failed: ${error.message}`);
    return 'ERROR';
  }
}

/**
 * Click button and wait for consent state change (supports CMP-specific selectors)
 * @param {Page} page - Puppeteer page
 * @param {Object|string} buttonInfo - Button object from findBannerButtons() or text string
 * @returns {Promise<boolean>} Success
 */
async function clickButton(page, buttonInfo) {
  try {
    // If buttonInfo is a string, search by text (legacy mode)
    const buttonText = typeof buttonInfo === 'string' ? buttonInfo : buttonInfo.text;
    const buttonSelector = typeof buttonInfo === 'object' ? buttonInfo.selector : null;

    // TRY 1: Use selector if available (more reliable)
    if (buttonSelector) {
      try {
        await page.click(buttonSelector);
        console.log(`   ✅ Clicked button via selector: ${buttonSelector}`);
      } catch (selectorError) {
        console.log(`   ⚠️  Selector click failed, trying evaluate method...`);

        // TRY 2: Fallback to evaluate click
        const clicked = await page.evaluate((selector) => {
          const button = document.querySelector(selector);
          if (button) {
            button.click();
            return true;
          }
          return false;
        }, buttonSelector);

        if (!clicked) {
          throw new Error(`Selector ${buttonSelector} not found`);
        }
      }
    } else {
      // TRY 3: Text-based search (last resort)
      const clicked = await page.evaluate((text) => {
        const allButtons = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
        const target = allButtons.find(b => {
          const buttonText = b.textContent.toLowerCase();
          return buttonText.includes(text.toLowerCase());
        });

        if (target) {
          target.click();
          return true;
        }
        return false;
      }, buttonText);

      if (!clicked) {
        console.log(`⚠️  Button "${buttonText}" not found`);
        return false;
      }

      console.log(`   ✅ Clicked button via text: "${buttonText}"`);
    }

    // Wait for consent state change using race condition strategy
    const trigger = await waitForConsentStateChange(page, 15000);
    console.log(`   ✅ Consent state changed via: ${trigger}`);

    // Additional wait for cookies to be set/removed
    await new Promise(resolve => setTimeout(resolve, 2000));

    return true;
  } catch (error) {
    console.error(`   ❌ Failed to click button:`, error.message);
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

    // Launch browser with EXTENDED protocolTimeout for CookieScript/CMP sites
    // Default 10s is too short - CDP protocol timeout-ва преди navigation да завърши
    browser = await launchBrowser({ protocolTimeout: 60000 }); // 60s protocol timeout
    const page = await createPage(browser);

    // NAVIGATION is BEST-EFFORT, NOT a prerequisite!
    // Even if navigation fails/timeout-s, consent UI may still be available
    console.log(`   📡 Attempting navigation (best-effort, NOT blocking)...`);
    try {
      await navigateToUrl(page, websiteUrl, 'reject-scenario', {
        waitUntil: 'load',
        timeout: 15000
      });
      console.log(`   ✅ Navigation completed successfully`);
    } catch (navError) {
      console.log(`   ⚠️  Navigation failed: ${navError.message}`);
      console.log(`   ➡️  Continuing anyway - consent UI may still be available...`);
      // DO NOT throw - navigation failure is diagnostic, NOT stopping condition!
    }

    // STATE CHECK: Wait for consent UI to be ready (REGARDLESS of navigation outcome!)
    const uiReady = await waitForConsentUIReady(page, 30000);
    if (!uiReady) {
      throw new Error('Consent UI never reached ready state - application not functional');
    }

    // Extract cookies BEFORE any interaction (NO delay - immediate state snapshot)
    const cookiesBeforeConsent = await extractCookies(page, { skipDelay: true });
    console.log(`   📸 Baseline cookies: ${cookiesBeforeConsent.length}`);

    // Find banner buttons (UI is ready, buttons must exist)
    const buttons = await findBannerButtons(page);

    let clickPath = [];
    let clickCount = 0;

    // Try to reject
    if (buttons.rejectButton) {
      // Direct reject button exists
      console.log(`   ✅ Found "Reject" button: "${buttons.rejectButton.text}"`);
      await clickButton(page, buttons.rejectButton);
      clickPath.push('Click Reject All');
      clickCount = 1;
    } else if (buttons.settingsButton) {
      // Must go through settings
      console.log(`   ⚠️  No direct Reject - using Settings`);
      await clickButton(page, buttons.settingsButton);
      clickPath.push('Click Settings');
      clickCount++;

      // Wait for settings panel to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to find "Reject All" in settings
      const settingsButtons = await findBannerButtons(page);
      if (settingsButtons.rejectButton) {
        await clickButton(page, settingsButtons.rejectButton);
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

    // STATE CHECK: Wait for consent transition to complete
    await waitForConsentTransition(page, 'reject', 15000);

    // TRACKING RUNTIME PROPAGATION: Wait for tracking logic to process rejection
    // This is NOT a procedural delay - it's waiting for runtime state propagation
    console.log(`   ⏱️  Waiting 3s for tracking runtime propagation...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract cookies AFTER consent state transition
    const cookiesAfterReject = await extractCookies(page, { delay: 3000 }); // WITH delay for async cookies

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

    // Launch NEW browser (separate context) with EXTENDED protocolTimeout
    browser = await launchBrowser({ protocolTimeout: 60000 }); // 60s protocol timeout
    const page = await createPage(browser);

    // NAVIGATION is BEST-EFFORT, NOT a prerequisite!
    // Even if navigation fails/timeout-s, consent UI may still be available
    console.log(`   📡 Attempting navigation (best-effort, NOT blocking)...`);
    try {
      await navigateToUrl(page, websiteUrl, 'accept-scenario', {
        waitUntil: 'load',
        timeout: 15000
      });
      console.log(`   ✅ Navigation completed successfully`);
    } catch (navError) {
      console.log(`   ⚠️  Navigation failed: ${navError.message}`);
      console.log(`   ➡️  Continuing anyway - consent UI may still be available...`);
      // DO NOT throw - navigation failure is diagnostic, NOT stopping condition!
    }

    // STATE CHECK: Wait for consent UI to be ready (REGARDLESS of navigation outcome!)
    const uiReady = await waitForConsentUIReady(page, 30000);
    if (!uiReady) {
      throw new Error('Consent UI never reached ready state - application not functional');
    }

    // Extract cookies BEFORE any interaction (immediate snapshot)
    const cookiesBeforeConsent = await extractCookies(page, { skipDelay: true });
    console.log(`   📸 Baseline cookies: ${cookiesBeforeConsent.length}`);

    // Find banner buttons (UI is ready, buttons must exist)
    const buttons = await findBannerButtons(page);

    let clickPath = [];
    let clickCount = 0;

    // Try to accept
    if (buttons.acceptButton) {
      console.log(`   ✅ Found "Accept" button: "${buttons.acceptButton.text}"`);
      await clickButton(page, buttons.acceptButton);
      clickPath.push('Click Accept All');
      clickCount = 1;
    } else {
      console.log(`   ❌ No Accept button found`);
    }

    // STATE CHECK: Wait for consent transition to complete
    await waitForConsentTransition(page, 'accept', 15000);

    // TRACKING RUNTIME PROPAGATION: Wait for tracking logic to initialize and load cookies
    // Google Analytics, Facebook Pixel, etc. initialize AFTER consent is granted
    // This is NOT a procedural delay - it's waiting for runtime initialization
    console.log(`   ⏱️  Waiting 5s for tracking runtime initialization...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Extract cookies AFTER tracking runtimes have initialized
    const cookiesAfterAccept = await extractCookies(page, { delay: 3000 }); // WITH delay for async cookies

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
