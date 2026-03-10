const noybViolations = require('../config/noyb-violations.json');
const {
  initDebugSession,
  logViolationCheck,
  saveScreenshot,
  logElementDetails,
  saveSummary,
  logError
} = require('../utils/violation-debug-logger');
const { createLogger } = require('../utils/logger');

const logger = createLogger('banner-checker');

// Debug mode flag (set via environment variable DEBUG_VIOLATIONS=true)
const DEBUG_VIOLATIONS = process.env.DEBUG_VIOLATIONS === 'true';

/**
 * Multi-language keyword sets for cookie banner detection
 */
const BUTTON_KEYWORDS = {
  accept: ['accept', 'agree', 'allow', 'ok', 'yes', 'akzeptieren', 'zustimmen', 'accepter', 'aceptar', 'accetto', 'aceitar', 'приемам', 'acceptuj', 'souhlasím', 'приема', 'съгласен', 'разрешавам'],
  reject: ['reject', 'decline', 'deny', 'refuse', 'ablehnen', 'refuser', 'rechazar', 'rifiuto', 'rejeitar', 'отказвам', 'odrzuć', 'odmítnout', 'отхвърлям', 'отказ', 'не приемам', 'отхвърляне'],
  settings: ['settings', 'customize', 'preferences', 'manage', 'options', 'einstellungen', 'anpassen', 'préférences', 'configuración', 'impostazioni', 'configurações', 'настройки', 'ustawienia', 'nastavení', 'персонализиране'],
  cookieSettings: ['cookie settings', 'privacy settings', 'manage cookies', 'cookie preferences', 'cookie-einstellungen', 'cookies verwalten', 'gestion des cookies', 'configuración de cookies', 'gestione cookie', 'configurações de cookies', 'настройки за бисквитки', 'zarządzaj cookie', 'управление на бисквитки']
};

/**
 * Hybrid element finder - CSS selectors + text matching fallback
 * @param {Array<Element>} elements - DOM elements to search
 * @param {Array<string>} keywords - Keywords to match
 * @returns {Element|null} Found element
 */
function findElementByTextHybrid(elements, keywords) {
  return elements.find(el => {
    const text = el.textContent.toLowerCase().trim();
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
  });
}

/**
 * Wait for cookie banner to be visible (iframe-aware)
 * @param {Page} page - Puppeteer page
 * @param {number} timeout - Max wait time (default: 10000ms)
 * @returns {Promise<Object>} { visible, method, screenshot }
 */
async function waitForBannerVisible(page, timeout = 15000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await page.evaluate(() => {
      // Generic CMP patterns — covers CookieScript, OneTrust, Cookiebot, Usercentrics,
      // CookieYes, Consentmo, Iubenda, CookieNotice, Complianz, TrustArc, and custom GDPR banners
      const selectors = [
        // CMP-specific selectors (most reliable — match first)
        '#cookiescript_injected',
        '#onetrust-banner-sdk',
        '#CybotCookiebotDialog',
        '[data-testid="uc-privacy-banner"]',
        '#iubenda-cs-banner',
        '.cc-window', '.cc-banner',
        '#cmplz-cookiebanner-container',
        '#truste-consent-track',
        '#cookie-law-info-bar',
        '#gdpr-cookie-notice',
        // Generic attribute patterns (broader match)
        '[id*="cookie"]', '[class*="cookie"]',
        '[id*="consent"]', '[class*="consent"]',
        '[id*="cmp"]', '[class*="cmp"]',
        '[id*="onetrust"]', '[class*="onetrust"]',
        '[id*="gdpr"]', '[class*="gdpr"]',
        '[id*="privacy"]', '[class*="privacy"]',
        '[class*="Cybot"]',
        '[data-nosnippet]',
        '[role="dialog"]', '[role="alertdialog"]'
      ];

      // Clickable element query — includes span/div with onclick and input buttons
      const clickableQuery = 'button, a, [role="button"], input[type="button"], input[type="submit"], [onclick], span[tabindex], div[tabindex]';

      // STEP 1: Search main document
      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector);
          if (el && el.offsetHeight > 0 && el.offsetWidth > 0) {
            const buttons = el.querySelectorAll(clickableQuery);
            if (buttons.length > 0) {
              return { visible: true, method: 'main_document', selector };
            }
          }
        } catch (e) {}
      }

      // STEP 2: Search iframes (CookieScript, OneTrust)
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) continue;

          // CRITICAL: Verify iframe has loaded content (not empty)
          const bodyHasContent = iframeDoc.body && iframeDoc.body.children.length > 0;
          if (!bodyHasContent) continue; // Skip empty iframe

          for (const selector of selectors) {
            const el = iframeDoc.querySelector(selector);
            if (el && el.offsetHeight > 0 && el.offsetWidth > 0) {
              const buttons = iframeDoc.querySelectorAll(clickableQuery);
              if (buttons.length > 0) {
                return {
                  visible: true,
                  method: 'iframe',
                  selector,
                  iframeSrc: iframe.src || 'about:blank',
                  buttonCount: buttons.length
                };
              }
            }
          }
        } catch (e) {
          // Cross-origin iframe - expected, skip
        }
      }

      return { visible: false };
    });

    if (result.visible) {
      const timeMs = Date.now() - startTime;
      const location = result.method === 'iframe' ? 'iframe' : 'main';

      logger.info('banner-found', {
        method: result.method,
        selector: result.selector,
        location,
        timeMs,
        iframeSrc: result.method === 'iframe' ? result.iframeSrc : undefined,
        buttonCount: result.method === 'iframe' ? result.buttonCount : undefined
      });

      // Capture screenshot for evidence (optional, may fail)
      let screenshot = null;
      try {
        screenshot = await page.screenshot({ fullPage: false, type: 'png' });
      } catch (e) {}

      return {
        found: true,
        visible: true,
        selector: result.selector || null,
        location,
        viewport: 'desktop',
        timeMs,
        method: result.method,
        screenshot
      };
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const timeMs = Date.now() - startTime;
  logger.warn('banner-wait-timeout', { timeoutMs: timeout, timeMs });
  return {
    found: false,
    visible: false,
    selector: null,
    location: null,
    viewport: 'desktop',
    timeMs
  };
}

/**
 * Detect banner with mobile viewport retry
 * If banner is not found at desktop viewport, resize to mobile (375x812) and retry.
 * @param {Page} page - Puppeteer page
 * @param {number} timeout - Max wait time per attempt (default: 10000ms)
 * @returns {Promise<Object>} Structured banner detection status
 */
async function detectBannerWithRetry(page, timeout = 15000) {
  // Try desktop viewport first
  const desktopResult = await waitForBannerVisible(page, timeout);
  if (desktopResult.found) return desktopResult;

  // Retry with mobile viewport
  logger.info('banner-mobile-retry', { reason: 'Desktop detection failed, retrying at mobile viewport 375x812' });
  const originalViewport = page.viewport();
  await page.setViewport({ width: 375, height: 812 });
  // Wait 2 seconds for responsive reflow
  await new Promise(r => setTimeout(r, 2000));

  const mobileResult = await waitForBannerVisible(page, timeout);
  mobileResult.viewport = 'mobile';

  // Restore original viewport
  if (originalViewport) {
    await page.setViewport(originalViewport);
  } else {
    await page.setViewport({ width: 1280, height: 800 });
  }
  // Wait 1 second for reflow back
  await new Promise(r => setTimeout(r, 1000));

  return mobileResult;
}

/**
 * Analyze cookie banner for noyb 8-point checklist violations
 * @param {Page} page - Puppeteer page
 * @param {string} auditId - Audit ID for debug logging
 * @param {Array} cookies - Optional cookies array for Type I check
 * @returns {Promise<Object>} Violations detected
 */
async function analyzeCookieBanner(page, auditId = null, cookies = null) {
  let debugSessionId = null;

  try {
    logger.info('banner-analysis-start', { auditId, hasCookies: !!cookies });

    // Initialize debug session if enabled
    if (DEBUG_VIOLATIONS && auditId) {
      debugSessionId = await initDebugSession(auditId);
      logger.info('banner-debug-enabled', { sessionId: debugSessionId });
    }

    // Detect banner with mobile viewport retry
    const bannerDetectionStatus = await detectBannerWithRetry(page);
    logger.info('banner-detection-result', {
      auditId,
      found: bannerDetectionStatus.found,
      viewport: bannerDetectionStatus.viewport,
      selector: bannerDetectionStatus.selector,
      location: bannerDetectionStatus.location,
      timeMs: bannerDetectionStatus.timeMs
    });

    // Gate: If no banner detected at any viewport, skip all violation checks
    if (!bannerDetectionStatus.found) {
      logger.warn('banner-not-detected', {
        auditId,
        desktopViewport: 'not found',
        mobileViewport: bannerDetectionStatus.viewport === 'mobile' ? 'not found' : 'not attempted'
      });

      return {
        bannerDetected: false,
        bannerDetectionStatus,
        violations: [],
        passedChecks: [],
        skippedChecks: [],
        overallResult: {
          finding: 'BANNER_NOT_DETECTED',
          description: 'No cookie consent banner was detected at desktop or mobile viewports. This is a GDPR violation: no consent mechanism was presented to the user.',
          severity: 'critical',
          gdprArticles: ['Art. 6(1)(a)', 'Art. 7', 'ePrivacy Art. 5(3)']
        },
        totalChecks: noybViolations.violations.length,
        passedCount: 0,
        violationCount: 0,
        skippedCount: noybViolations.violations.length,
        compliancePercentage: 0,
        checksRun: 0,
        hasCriticalViolations: false,
        debugSessionId: DEBUG_VIOLATIONS ? debugSessionId : null
      };
    }

    const violations = [];
    const passedChecks = [];
    const skippedChecks = [];
    const debugLogs = [];

    // Add BANNER_MOBILE_ONLY finding if banner found only on mobile
    if (bannerDetectionStatus.found && bannerDetectionStatus.viewport === 'mobile') {
      violations.push({
        id: 'BANNER_MOBILE_ONLY',
        name: 'Banner renders only on mobile viewport',
        severity: 'high',
        description: 'Cookie consent banner renders only on mobile viewport. Desktop users are not presented with a consent mechanism.',
        legal_basis: 'GDPR Art. 7, ePrivacy Art. 5(3)',
        evidence: {
          message: 'Banner detected at mobile viewport (375x812) but not at desktop viewport',
          viewport: 'mobile',
          selector: bannerDetectionStatus.selector,
          location: bannerDetectionStatus.location
        }
      });
      logger.warn('banner-mobile-only', { auditId, selector: bannerDetectionStatus.selector });
    }

    // Check each violation type
    for (const violation of noybViolations.violations) {
      const result = await checkViolation(page, violation, debugSessionId, cookies);

      if (result.skipped) {
        skippedChecks.push({
          id: violation.id,
          name: violation.name,
          reason: result.skipReason || 'Check could not be performed'
        });
        logger.info('banner-check-skipped', { auditId, violationId: violation.id, reason: result.skipReason });
      } else if (result.detected) {
        violations.push({
          id: violation.id,
          name: violation.name,
          severity: violation.severity,
          description: violation.description,
          legal_basis: violation.legal_basis,
          evidence: result.evidence
        });
        logger.warn('banner-violation-detected', { auditId, violationId: violation.id, name: violation.name, severity: violation.severity });
      } else {
        passedChecks.push({
          id: violation.id,
          name: violation.name
        });
        logger.info('banner-check-passed', { auditId, violationId: violation.id });
      }

      // Save debug log for this violation
      if (DEBUG_VIOLATIONS && debugSessionId) {
        debugLogs.push({
          violationType: violation.id,
          detected: result.detected,
          skipped: result.skipped || false,
          evidence: result.evidence
        });

        await logViolationCheck(debugSessionId, violation.id, {
          detected: result.detected,
          skipped: result.skipped || false,
          violationName: violation.name,
          severity: violation.severity,
          evidence: result.evidence
        });
      }
    }

    const totalChecks = noybViolations.violations.length;
    const passedCount = passedChecks.length;
    const violationCount = violations.length;
    const skippedCount = skippedChecks.length;
    const compliancePercentage = Math.round((passedCount / (totalChecks - skippedCount)) * 100);

    logger.info('banner-analysis-complete', {
      auditId,
      passedCount,
      totalChecks,
      effectiveChecks: totalChecks - skippedCount,
      compliancePercentage,
      skippedCount,
      violationCount
    });

    // Save debug summary
    if (DEBUG_VIOLATIONS && debugSessionId) {
      await saveSummary(debugSessionId, {
        totalChecks,
        passedCount,
        violationCount,
        skippedCount,
        compliancePercentage,
        violations: violations.map(v => v.id),
        passedChecks: passedChecks.map(c => c.id),
        skippedChecks: skippedChecks.map(c => c.id)
      });
    }

    return {
      bannerDetected: bannerDetectionStatus.found,
      bannerDetectionStatus,
      violations,
      passedChecks,
      skippedChecks,
      totalChecks,
      passedCount,
      violationCount,
      skippedCount,
      compliancePercentage,
      hasCriticalViolations: violations.some(v => v.severity === 'critical'),
      debugSessionId: DEBUG_VIOLATIONS ? debugSessionId : null
    };
  } catch (error) {
    logger.error('banner-analysis-failed', { error: '❌ ' + error.message, auditId, stack: error.stack });

    // Log error if debug enabled
    if (DEBUG_VIOLATIONS && debugSessionId) {
      await logError(debugSessionId, 'banner_analysis', error, {
        auditId,
        timestamp: new Date().toISOString()
      });
    }

    throw error;
  }
}

/**
 * Check individual violation
 * @param {Page} page - Puppeteer page
 * @param {Object} violation - Violation definition
 * @param {string} debugSessionId - Debug session ID (optional)
 * @param {Array} cookies - Cookies array for Type I check (optional)
 * @returns {Promise<Object>} Detection result
 */
async function checkViolation(page, violation, debugSessionId = null, cookies = null) {
  try {
    let result;

    switch (violation.id) {
      case 'type_a':
        result = await checkNoRejectButton(page, violation, debugSessionId);
        break;
      case 'type_b':
        result = await checkPreTickedBoxes(page, violation, debugSessionId);
        break;
      case 'type_c':
        result = await checkDeceptiveLinkDesign(page, violation, debugSessionId);
        break;
      case 'type_d':
        result = await checkDeceptiveButtonColors(page, violation, debugSessionId);
        break;
      case 'type_e':
        result = await checkDeceptiveButtonContrast(page, violation, debugSessionId);
        break;
      case 'type_h':
        result = await checkLegitimateInterestForAds(page, violation, debugSessionId);
        break;
      case 'type_i':
        result = checkMisclassifiedEssentialCookies(cookies, violation);
        break;
      case 'type_k':
        result = await checkDifficultConsentWithdrawal(page, violation, debugSessionId);
        break;
      default:
        result = {
          detected: false,
          skipped: true,
          skipReason: 'Unknown violation type',
          evidence: null
        };
    }

    return result;
  } catch (error) {
    logger.error('banner-check-error', {
      error: `❌ ${violation.id} check failed: ` + error.message,
      violationId: violation.id,
      stack: error.stack
    });

    if (DEBUG_VIOLATIONS && debugSessionId) {
      await logError(debugSessionId, violation.id, error, {
        violationName: violation.name
      });
    }

    // Return SKIPPED status instead of false on error
    return {
      detected: false,
      skipped: true,
      skipReason: `Check failed: ${error.message}`,
      evidence: null,
      error: error.message
    };
  }
}

/**
 * Type A: No Reject Button on First Layer
 */
async function checkNoRejectButton(page, violation) {
  try {
    // STEP 1: Wait for cookie banner to be visible (universal approach)
    const bannerResult = await waitForBannerVisible(page, 10000);

    if (!bannerResult.visible) {
      logger.warn('banner-not-visible', { check: 'Type-A' });
    } else {
      logger.info('banner-visible', { check: 'Type-A', method: bannerResult.method });
    }

    // STEP 2: Search for buttons in ALL contexts (main doc + iframes + shadow DOM)
    const result = await page.evaluate((keywords) => {
      const buttons = [];

      // Context 1: Main document
      buttons.push(...Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]')));

      // Context 2: All accessible iframes (same-origin only)
      document.querySelectorAll('iframe').forEach(iframe => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            buttons.push(...Array.from(iframeDoc.querySelectorAll('button, a, div[role="button"], span[role="button"]')));
          }
        } catch (e) {
          // Cross-origin iframe, cannot access (expected for some cases)
        }
      });

      // Context 3: Shadow DOM elements
      document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          buttons.push(...Array.from(el.shadowRoot.querySelectorAll('button, a, div[role="button"], span[role="button"]')));
        }
      });

      // Find accept button using multiple strategies
      let acceptButton = null;

      // Strategy 1: CSS attribute/class selectors
      acceptButton = buttons.find(b =>
        b.getAttribute('data-action') === 'accept' ||
        b.getAttribute('id')?.includes('accept') ||
        b.className?.includes('accept')
      );

      // Strategy 2: Text content matching (multi-language)
      if (!acceptButton) {
        acceptButton = buttons.find(b => {
          const text = b.textContent?.toLowerCase().trim() || '';
          return keywords.accept.some(keyword => text.includes(keyword.toLowerCase()));
        });
      }

      // Find reject button using multiple strategies
      let rejectButton = null;

      // Strategy 1: CSS attribute/class selectors (expanded for better coverage)
      rejectButton = buttons.find(b =>
        b.getAttribute('data-action') === 'reject' ||
        b.getAttribute('data-action') === 'deny' ||
        b.getAttribute('id')?.toLowerCase().includes('reject') ||
        b.getAttribute('id')?.toLowerCase().includes('decline') ||
        b.getAttribute('id')?.toLowerCase().includes('deny') ||
        b.className?.toLowerCase().includes('reject') ||
        b.className?.toLowerCase().includes('decline') ||
        b.className?.toLowerCase().includes('deny')
      );

      // Strategy 2: Text content matching (multi-language, more flexible)
      if (!rejectButton) {
        rejectButton = buttons.find(b => {
          const text = b.textContent?.toLowerCase().trim() || '';
          return keywords.reject.some(keyword => text.includes(keyword.toLowerCase()));
        });
      }

      return {
        hasAcceptButton: !!acceptButton,
        hasRejectButton: !!rejectButton,
        acceptText: acceptButton?.textContent?.trim() || '',
        rejectText: rejectButton?.textContent?.trim() || '',
        totalButtonsFound: buttons.length,
        contextsSearched: {
          mainDoc: true,
          iframes: document.querySelectorAll('iframe').length,
          shadowDoms: Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot).length
        }
      };
    }, BUTTON_KEYWORDS);

    // DEBUG: Log button detection results
    logger.debug('button-detection-results', {
      check: 'Type-A',
      totalButtons: result.totalButtonsFound,
      hasAccept: result.hasAcceptButton,
      acceptText: result.acceptText,
      hasReject: result.hasRejectButton,
      rejectText: result.rejectText,
      iframes: result.contextsSearched.iframes,
      shadowDoms: result.contextsSearched.shadowDoms
    });

    // Violation detected if accept button exists but reject button doesn't
    const detected = result.hasAcceptButton && !result.hasRejectButton;

    return {
      detected,
      evidence: detected ? {
        message: 'Accept button found without equally prominent Reject button',
        acceptButton: result.acceptText,
        rejectButton: result.rejectText || 'Not found'
      } : null
    };
  } catch (error) {
    logger.error('type-a-check-failed', { error: '❌ Type A check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Type A check failed: ${error.message}`,
      evidence: null
    };
  }
}

/**
 * Type B: Pre-ticked Boxes
 */
async function checkPreTickedBoxes(page, violation) {
  try {
    const result = await page.evaluate(() => {
      const checkedBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));

      // Filter out essential checkboxes (typically have 'necessary', 'essential', 'required' in label/name)
      const nonEssentialChecked = checkedBoxes.filter(cb => {
        const label = cb.labels?.[0]?.textContent.toLowerCase() || '';
        const name = cb.name.toLowerCase();
        const id = cb.id.toLowerCase();

        const isEssential =
          label.includes('necessary') ||
          label.includes('essential') ||
          label.includes('required') ||
          name.includes('necessary') ||
          id.includes('necessary');

        return !isEssential;
      });

      return {
        totalChecked: checkedBoxes.length,
        nonEssentialChecked: nonEssentialChecked.length,
        details: nonEssentialChecked.map(cb => ({
          name: cb.name,
          id: cb.id,
          label: cb.labels?.[0]?.textContent.trim()
        }))
      };
    });

    const detected = result.nonEssentialChecked > 0;

    return {
      detected,
      evidence: detected ? {
        message: `${result.nonEssentialChecked} non-essential checkboxes are pre-ticked`,
        preTickedBoxes: result.details
      } : null
    };
  } catch (error) {
    logger.error('type-b-check-failed', { error: '❌ Type B check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Type B check failed: ${error.message}`,
      evidence: null
    };
  }
}

/**
 * Type C: Deceptive Link Design
 */
async function checkDeceptiveLinkDesign(page, violation) {
  try {
    const result = await page.evaluate((keywords) => {
      // Find accept button using multi-language text matching
      const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
      const acceptButton = buttons.find(b => {
        const text = b.textContent.toLowerCase().trim();
        return keywords.accept.some(keyword => text.includes(keyword.toLowerCase()));
      });

      // Find settings/customize link using multi-language text matching
      const settingsLink = buttons.find(b => {
        const text = b.textContent.toLowerCase().trim();
        const tagName = b.tagName.toLowerCase();
        return keywords.settings.some(keyword => text.includes(keyword.toLowerCase())) &&
               tagName === 'a'; // It's a link, not a button
      });

      if (!acceptButton || !settingsLink) {
        return { mismatch: false };
      }

      const acceptStyle = window.getComputedStyle(acceptButton);
      const settingsStyle = window.getComputedStyle(settingsLink);

      const acceptFontSize = parseFloat(acceptStyle.fontSize);
      const settingsFontSize = parseFloat(settingsStyle.fontSize);
      const fontSizeRatio = settingsFontSize / acceptFontSize;

      return {
        mismatch: true,
        acceptTagName: acceptButton.tagName,
        settingsTagName: settingsLink.tagName,
        fontSizeRatio: fontSizeRatio,
        acceptFontSize: acceptFontSize,
        settingsFontSize: settingsFontSize
      };
    }, BUTTON_KEYWORDS);

    // Violation if settings is a link while accept is a button AND font size ratio < 0.7
    const detected = result.mismatch &&
                    result.acceptTagName === 'BUTTON' &&
                    result.settingsTagName === 'A' &&
                    result.fontSizeRatio < violation.styling_checks.font_size_ratio_max;

    return {
      detected,
      evidence: detected ? {
        message: 'Settings link is significantly smaller than Accept button',
        acceptElement: result.acceptTagName,
        settingsElement: result.settingsTagName,
        fontSizeRatio: result.fontSizeRatio.toFixed(2)
      } : null
    };
  } catch (error) {
    logger.error('type-c-check-failed', { error: '❌ Type C check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Type C check failed: ${error.message}`,
      evidence: null
    };
  }
}

/**
 * Type D: Deceptive Button Colors
 * Uses HSL-based color similarity detection instead of exact matching
 */
async function checkDeceptiveButtonColors(page, violation) {
  try {
    const result = await page.evaluate((data) => {
      const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));

      const acceptButton = buttons.find(b => {
        const text = b.textContent.toLowerCase().trim();
        return data.keywords.accept.some(keyword => text.includes(keyword.toLowerCase()));
      });

      const rejectButton = buttons.find(b => {
        const text = b.textContent.toLowerCase().trim();
        return data.keywords.reject.some(keyword => text.includes(keyword.toLowerCase()));
      });

      if (!acceptButton || !rejectButton) {
        return { hasButtons: false };
      }

      const acceptBg = window.getComputedStyle(acceptButton).backgroundColor;
      const rejectBg = window.getComputedStyle(rejectButton).backgroundColor;

      // Convert rgb to hex AND HSL for similarity matching
      const rgbToHex = (rgb) => {
        const match = rgb.match(/\d+/g);
        if (!match) return null;
        return '#' + match.map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
      };

      const rgbToHsl = (rgb) => {
        const match = rgb.match(/\d+/g);
        if (!match || match.length < 3) return null;

        let [r, g, b] = match.map(x => parseInt(x) / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
          h = s = 0; // achromatic (grey)
        } else {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

          switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
          }
        }

        return {
          h: Math.round(h * 360),
          s: Math.round(s * 100),
          l: Math.round(l * 100)
        };
      };

      return {
        hasButtons: true,
        acceptColor: rgbToHex(acceptBg),
        rejectColor: rgbToHex(rejectBg),
        acceptHsl: rgbToHsl(acceptBg),
        rejectHsl: rgbToHsl(rejectBg)
      };
    }, { keywords: BUTTON_KEYWORDS, colorPatterns: violation.color_patterns });

    if (!result.hasButtons) {
      return { detected: false, evidence: null };
    }

    // Strategy 1: Exact match (legacy)
    const acceptIsAttractive = violation.color_patterns.accept_attractive.some(color =>
      result.acceptColor?.toLowerCase() === color.toLowerCase()
    );
    const rejectIsMuted = violation.color_patterns.reject_muted.some(color =>
      result.rejectColor?.toLowerCase() === color.toLowerCase()
    );
    const exactMatch = acceptIsAttractive && rejectIsMuted;

    // Strategy 2: HSL similarity (more reliable)
    let hslMatch = false;
    if (result.acceptHsl && result.rejectHsl) {
      const acceptHsl = result.acceptHsl;
      const rejectHsl = result.rejectHsl;

      // Accept is "attractive" if:
      // - Hue is green (90-150°) or blue (180-260°)
      // - Saturation > 40% (vibrant)
      // - Lightness 40-70% (not too dark/bright)
      const acceptIsAttractiveSimilar = (
        ((acceptHsl.h >= 90 && acceptHsl.h <= 150) ||   // Green range
         (acceptHsl.h >= 180 && acceptHsl.h <= 260)) &&  // Blue range
        acceptHsl.s > 40 &&
        acceptHsl.l >= 40 && acceptHsl.l <= 70
      );

      // Reject is "muted" if:
      // - Saturation < 15% (desaturated/grey)
      // - OR Lightness > 80% (very light grey/white)
      const rejectIsMutedSimilar = (
        rejectHsl.s < 15 ||
        rejectHsl.l > 80
      );

      hslMatch = acceptIsAttractiveSimilar && rejectIsMutedSimilar;
    }

    const detected = exactMatch || hslMatch;

    return {
      detected,
      evidence: detected ? {
        message: 'Accept button uses attractive color while Reject is muted',
        acceptColor: result.acceptColor,
        rejectColor: result.rejectColor,
        acceptHsl: result.acceptHsl,
        rejectHsl: result.rejectHsl,
        detectionMethod: exactMatch ? 'exact_match' : 'hsl_similarity'
      } : null
    };
  } catch (error) {
    logger.error('type-d-check-failed', { error: '❌ Type D check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Color check failed: ${error.message}`,
      evidence: null
    };
  }
}

/**
 * Type E: Deceptive Button Contrast
 */
async function checkDeceptiveButtonContrast(page, violation) {
  try {
    const result = await page.evaluate((keywords) => {
      const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));

      const acceptButton = buttons.find(b => {
        const text = b.textContent.toLowerCase().trim();
        return keywords.accept.some(keyword => text.includes(keyword.toLowerCase()));
      });

      const rejectButton = buttons.find(b => {
        const text = b.textContent.toLowerCase().trim();
        return keywords.reject.some(keyword => text.includes(keyword.toLowerCase()));
      });

      if (!acceptButton || !rejectButton) {
        return { hasButtons: false };
      }

      const acceptStyle = window.getComputedStyle(acceptButton);
      const rejectStyle = window.getComputedStyle(rejectButton);

      const acceptWidth = acceptButton.offsetWidth;
      const acceptHeight = acceptButton.offsetHeight;
      const rejectWidth = rejectButton.offsetWidth;
      const rejectHeight = rejectButton.offsetHeight;

      const acceptArea = acceptWidth * acceptHeight;
      const rejectArea = rejectWidth * rejectHeight;
      const sizeRatio = acceptArea / rejectArea;

      const acceptWeight = parseInt(acceptStyle.fontWeight) || 400;
      const rejectWeight = parseInt(rejectStyle.fontWeight) || 400;
      const weightDiff = acceptWeight - rejectWeight;

      const acceptPadding = parseFloat(acceptStyle.paddingTop) + parseFloat(acceptStyle.paddingBottom);
      const rejectPadding = parseFloat(rejectStyle.paddingTop) + parseFloat(rejectStyle.paddingBottom);
      const paddingRatio = acceptPadding / rejectPadding;

      return {
        hasButtons: true,
        sizeRatio,
        weightDiff,
        paddingRatio,
        acceptSize: acceptArea,
        rejectSize: rejectArea
      };
    }, BUTTON_KEYWORDS);

    if (!result.hasButtons) {
      return { detected: false, evidence: null };
    }

    // Check if accept is significantly more prominent
    const sizeViolation = result.sizeRatio > violation.styling_checks.size_ratio_max;
    const weightViolation = result.weightDiff > violation.styling_checks.font_weight_difference_max;
    const paddingViolation = result.paddingRatio > violation.styling_checks.padding_ratio_max;

    const detected = sizeViolation || weightViolation || paddingViolation;

    return {
      detected,
      evidence: detected ? {
        message: 'Accept button is significantly more prominent than Reject',
        sizeRatio: result.sizeRatio.toFixed(2),
        weightDiff: result.weightDiff,
        paddingRatio: result.paddingRatio.toFixed(2),
        violations: {
          size: sizeViolation,
          weight: weightViolation,
          padding: paddingViolation
        }
      } : null
    };
  } catch (error) {
    logger.error('type-e-check-failed', { error: '❌ Type E check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Type E check failed: ${error.message}`,
      evidence: null
    };
  }
}

/**
 * Type H: Legitimate Interest Claimed for Ads
 */
async function checkLegitimateInterestForAds(page, violation) {
  try {
    const result = await page.evaluate((patterns) => {
      const bodyText = document.body.innerText.toLowerCase();

      const hasLegitimateInterest = patterns.some(pattern =>
        bodyText.includes(pattern.toLowerCase())
      );

      if (!hasLegitimateInterest) {
        return { found: false };
      }

      // Check if it's related to advertising/marketing
      const adKeywords = [
        'advertising',
        'advertisement',
        'marketing',
        'targeting',
        'profiling',
        'personalized ads',
        'behavioural advertising'
      ];

      const hasAdContext = adKeywords.some(keyword => bodyText.includes(keyword));

      return {
        found: hasLegitimateInterest && hasAdContext
      };
    }, violation.text_patterns);

    return {
      detected: result.found,
      evidence: result.found ? {
        message: 'Banner claims legitimate interest for advertising/profiling'
      } : null
    };
  } catch (error) {
    logger.error('type-h-check-failed', { error: '❌ Type H check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Type H check failed: ${error.message}`,
      evidence: null
    };
  }
}

/**
 * Type I: Misclassified Essential Cookies
 * Note: This requires cookie data from scanner
 * @param {Array} cookies - Detected cookies from scanner
 * @param {Object} violation - Violation definition
 */
function checkMisclassifiedEssentialCookies(cookies, violation) {
  try {
    if (!cookies || !Array.isArray(cookies)) {
      return {
        detected: false,
        skipped: true,
        skipReason: 'No cookies data available',
        evidence: null
      };
    }

    // Find cookies marked as essential/necessary
    const essentialCookies = cookies.filter(c =>
      c.category === 'essential' || c.category === 'necessary'
    );

    // Check if any essential cookie matches tracking patterns
    const misclassified = essentialCookies.filter(cookie => {
      return violation.tracking_patterns_forbidden.some(pattern =>
        cookie.name.includes(pattern)
      );
    });

    const detected = misclassified.length > 0;

    return {
      detected,
      evidence: detected ? {
        message: `${misclassified.length} tracking cookies incorrectly marked as essential`,
        misclassifiedCookies: misclassified.map(c => ({
          name: c.name,
          domain: c.domain,
          markedAs: 'essential',
          actualType: 'tracking'
        }))
      } : null
    };
  } catch (error) {
    logger.error('type-i-check-failed', { error: '❌ Type I check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Type I check failed: ${error.message}`,
      evidence: null
    };
  }
}

/**
 * Type K: Difficult Consent Withdrawal
 */
async function checkDifficultConsentWithdrawal(page, violation) {
  try {
    const result = await page.evaluate((keywords) => {
      // Look for persistent consent management elements (only valid CSS selectors)
      const selectors = [
        // Footer links
        'footer a[href*="cookie"]',
        'footer a[href*="privacy"]',
        // Floating buttons/icons
        '.cookie-settings-btn',
        '#cookie-settings',
        '[class*="cookie-icon"]',
        '[class*="privacy-icon"]',
        // Header links
        'header a[href*="cookie"]',
        'nav a[href*="cookie"]'
      ];

      let foundElements = [];
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            foundElements.push({
              selector,
              count: elements.length,
              text: elements[0].textContent.trim()
            });
          }
        } catch (e) {
          // Skip invalid selectors
          continue;
        }
      }

      // Enhanced text-based search with multi-language support
      const allLinks = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
      const settingsLinks = allLinks.filter(el => {
        const text = el.textContent.toLowerCase().trim();
        return keywords.cookieSettings.some(keyword => text.includes(keyword.toLowerCase()));
      });

      return {
        hasWithdrawalMechanism: foundElements.length > 0 || settingsLinks.length > 0,
        foundElements,
        settingsLinksCount: settingsLinks.length
      };
    }, BUTTON_KEYWORDS);

    const detected = !result.hasWithdrawalMechanism;

    return {
      detected,
      evidence: detected ? {
        message: 'No persistent mechanism found to withdraw consent after acceptance'
      } : null
    };
  } catch (error) {
    logger.error('type-k-check-failed', { error: '❌ Type K check failed: ' + error.message });
    return {
      detected: false,
      skipped: true,
      skipReason: `Type K check failed: ${error.message}`,
      evidence: null
    };
  }
}

module.exports = {
  analyzeCookieBanner,
  checkMisclassifiedEssentialCookies
};
