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
 * Consent keyword corpus for anchor-based banner detection.
 * Inspired by Consent Observatory's WordBoxGatherer (CHI 2025).
 * Covers EU/EEA languages. Used to identify consent banners by content, not just selectors.
 */
const CONSENT_TRIGGERS = [
  // International / English
  'cookie', 'cookies', 'consent', 'gdpr', 'privacy', 'accept', 'agree',
  // German
  'datenschutz', 'akzeptieren', 'zustimmen',
  // French
  'confidentialité', 'accepter',
  // Spanish
  'privacidad', 'aceptar',
  // Italian
  'consenso', 'accetta',
  // Portuguese
  'consentimento', 'aceitar',
  // Dutch
  'accepteren', 'toestemming',
  // Bulgarian
  'бисквитки', 'бисквитките', 'поверителност', 'приемам', 'съгласие', 'съгласен',
  // Polish
  'plików', 'akceptuję',
  // Czech
  'souhlasím', 'souhlas',
  // Romanian
  'cookie-uri', 'consimțământ',
  // Hungarian
  'elfogadom', 'hozzájárulás', 'sütik',
  // Swedish
  'acceptera', 'kakor',
  // Danish
  'samtykke', 'acceptér',
  // Finnish
  'evästeitä', 'hyväksy',
  // Croatian
  'prihvaćam', 'kolačići',
  // Slovak
  'súhlasím',
  // Slovenian
  'piškotki', 'strinjam',
  // Lithuanian
  'slapukai', 'sutinku',
  // Latvian
  'sīkdatnes', 'piekrītu',
  // Estonian
  'küpsised', 'nõustun',
  // Greek
  'απορρήτου', 'αποδοχή', 'συμφωνώ'
];

/**
 * CMP-specific selectors — fallback when anchor detection doesn't find a match.
 * Includes 72 CMP patterns from Consent Observatory's CMPGatherer.
 */
const CMP_SELECTORS = [
  '#cookiescript_injected', '#onetrust-banner-sdk', '#CybotCookiebotDialog',
  '[data-testid="uc-privacy-banner"]', '#iubenda-cs-banner',
  '.cc-window', '.cc-banner', '#cmplz-cookiebanner-container',
  '#truste-consent-track', '#cookie-law-info-bar', '#gdpr-cookie-notice',
  '#tarteaucitronRoot', '.borlabs-cookie', '#cmpbox', '#didomi-host',
  '#axeptio_overlay', '#sp_message_container', '#qc-cmp2-ui',
  '.cookie-permission--container', '.shopify-pc__banner',
  '[id*="cookie"]', '[class*="cookie"]',
  '[id*="consent"]', '[class*="consent"]',
  '[id*="cmp"]', '[class*="cmp"]',
  '[id*="gdpr"]', '[class*="gdpr"]',
  '[id*="privacy"]', '[class*="privacy"]',
  '[class*="Cybot"]',
  '[role="dialog"]', '[role="alertdialog"]'
];

/**
 * Wait for cookie banner to be visible using anchor-based detection.
 *
 * Two-phase approach inspired by Consent Observatory's WordBoxGatherer:
 * Phase A: Find DOM elements with position:fixed or z-index > 10 (anchors),
 *          then check if they contain consent keywords → high confidence match.
 * Phase B: Fall back to CMP-specific selectors if anchor detection fails.
 *
 * Returns the matched banner CSS selector so checks can be scoped to it.
 *
 * @param {Page} page - Puppeteer page
 * @param {number} timeout - Max wait time (default: 15000ms)
 * @returns {Promise<Object>} { found, visible, selector, location, viewport, timeMs, method }
 */
async function waitForBannerVisible(page, timeout = 15000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await page.evaluate((triggers, cmpSelectors) => {
      const clickableQuery = 'button, a, [role="button"], input[type="button"], input[type="submit"], [onclick], span[tabindex], div[tabindex]';
      const buttonOnlyQuery = 'button, [role="button"], input[type="button"], input[type="submit"]';
      const diagnostics = []; // Collect anchor candidates for logging

      // ──── PHASE A: CMP-specific selectors (highest precision, no false positives) ────
      // Run BEFORE anchor detection to avoid false positives on nav/header elements.
      for (const selector of cmpSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && el.offsetHeight > 0 && el.offsetWidth > 0) {
            const buttons = el.querySelectorAll(clickableQuery);
            if (buttons.length > 0) {
              return { visible: true, method: 'selector', selector, buttonCount: buttons.length, diagnostics };
            }
          }
        } catch (e) {}
      }

      // ──── PHASE B: Anchor-based detection (fallback for unknown CMPs) ────
      // Find elements with position:fixed or high z-index — potential overlays/banners
      function findAnchors(root) {
        const anchors = [];
        function recurse(el) {
          if (!el || el === document.documentElement) return;
          try {
            const style = getComputedStyle(el);
            const zIndex = parseInt(style.zIndex);
            if (
              (style.position === 'fixed' || style.position === 'sticky') ||
              (!isNaN(zIndex) && zIndex > 10)
            ) {
              anchors.push(el);
              return; // Don't recurse — the container itself is the anchor
            }
          } catch (e) {}
          for (const child of el.children) recurse(child);
          // Pierce open Shadow DOM
          if (el.shadowRoot) {
            for (const child of el.shadowRoot.children) recurse(child);
          }
        }
        recurse(root);
        return anchors;
      }

      const anchors = findAnchors(document.body);

      for (const anchor of anchors) {
        const style = getComputedStyle(anchor);
        const classAndId = (Array.from(anchor.classList).join(' ') + ' ' + (anchor.id || '')).toLowerCase();
        const role = anchor.getAttribute('role') || '';
        const tag = anchor.tagName;

        // ── Diagnostic info for this candidate (always collected) ──
        const text = (anchor.textContent || '').toLowerCase();
        const keywordMatch = triggers.find(t => text.includes(t)) || null;
        const actualButtons = anchor.querySelectorAll(buttonOnlyQuery);
        const linkCount = anchor.querySelectorAll('a').length;

        // ── Filter 1: Must be visible ──
        if (anchor.offsetHeight === 0 || anchor.offsetWidth === 0) {
          diagnostics.push({ tag, id: anchor.id || null, classes: classAndId.trim().substring(0, 60), reason: 'hidden', selected: false });
          continue;
        }

        // ── Filter 2: Skip navigation/header elements ──
        const isNavigation = (
          tag === 'NAV' || tag === 'HEADER' ||
          role === 'navigation' ||
          /\bnav(bar)?\b|\bheader\b|\bmenu\b|\bnavigation\b/.test(classAndId)
        );
        if (isNavigation) {
          diagnostics.push({ tag, id: anchor.id || null, classes: classAndId.trim().substring(0, 60), reason: 'navigation-excluded', keywordMatch, buttonCount: actualButtons.length, linkCount, selected: false });
          continue;
        }

        // ── Filter 3: Must contain consent keywords ──
        if (!keywordMatch) {
          diagnostics.push({ tag, id: anchor.id || null, classes: classAndId.trim().substring(0, 60), reason: 'no-consent-keyword', selected: false });
          continue;
        }

        // ── Filter 4: Must have at least one real button (not just nav links) ──
        if (actualButtons.length === 0) {
          diagnostics.push({ tag, id: anchor.id || null, classes: classAndId.trim().substring(0, 60), reason: 'no-buttons-only-links', keywordMatch, linkCount, selected: false });
          continue;
        }

        // ── This anchor passes all filters — build selector ──
        let selector = null;
        if (anchor.id) {
          selector = '#' + CSS.escape(anchor.id);
        } else {
          for (const cls of anchor.classList) {
            if (document.querySelectorAll('.' + CSS.escape(cls)).length === 1) {
              selector = '.' + CSS.escape(cls);
              break;
            }
          }
        }
        if (!selector && anchor.getAttribute('role')) {
          selector = `[role="${anchor.getAttribute('role')}"]`;
        }

        const allClickable = anchor.querySelectorAll(clickableQuery);
        diagnostics.push({ tag, id: anchor.id || null, classes: classAndId.trim().substring(0, 60), reason: 'selected', keywordMatch, buttonCount: actualButtons.length, linkCount, textSnippet: text.substring(0, 80), selected: true });

        return {
          visible: true,
          method: 'anchor',
          selector,
          anchorTag: tag,
          buttonCount: allClickable.length,
          keywordMatch,
          textSnippet: text.substring(0, 100),
          diagnostics
        };
      }

      // ──── PHASE C: Iframe search ────
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc || !iframeDoc.body || iframeDoc.body.children.length === 0) continue;

          const text = (iframeDoc.body.textContent || '').toLowerCase();
          const hasConsentKeyword = triggers.some(t => text.includes(t));
          if (!hasConsentKeyword) continue;

          const buttons = iframeDoc.querySelectorAll(clickableQuery);
          if (buttons.length > 0) {
            return {
              visible: true,
              method: 'iframe',
              selector: null,
              iframeSrc: iframe.src || 'about:blank',
              buttonCount: buttons.length,
              diagnostics
            };
          }
        } catch (e) {
          // Cross-origin iframe — expected, skip
        }
      }

      return { visible: false, diagnostics };
    }, CONSENT_TRIGGERS, CMP_SELECTORS);

    // Log anchor candidates evaluated (diagnostic — helps debug false positives)
    if (result.diagnostics && result.diagnostics.length > 0) {
      logger.debug('anchor-candidates-evaluated', { count: result.diagnostics.length, candidates: result.diagnostics });
    }

    if (result.visible) {
      const timeMs = Date.now() - startTime;
      const location = result.method === 'iframe' ? 'iframe' : 'main';

      logger.info('banner-found', {
        method: result.method,
        selector: result.selector,
        location,
        timeMs,
        buttonCount: result.buttonCount,
        keywordMatch: result.keywordMatch,
        anchorTag: result.anchorTag,
        iframeSrc: result.method === 'iframe' ? result.iframeSrc : undefined,
        textSnippet: result.textSnippet
      });

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
  // Store original viewport so caller can restore after checks complete
  mobileResult.originalViewport = originalViewport || { width: 1280, height: 800 };

  // DO NOT restore desktop viewport here — banner would disappear.
  // analyzeCookieBanner() restores viewport AFTER all noyb checks complete.

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

    // Clear CMP consent cookies to ensure banner appears fresh
    try {
      const consentCookiePatterns = ['CookieScriptConsent', 'cookieconsent_status',
        'CookieConsent', 'OptanonConsent', 'eupubconsent', 'CookiebotConsent',
        'didomi_token', 'iubenda_cs', 'cmplz_'];
      const currentCookies = await page.cookies();
      const consentCookies = currentCookies.filter(c =>
        consentCookiePatterns.some(p => c.name.includes(p))
      );
      if (consentCookies.length > 0) {
        await page.deleteCookie(...consentCookies);
        logger.info('cleared-consent-cookies', { count: consentCookies.length, names: consentCookies.map(c => c.name) });
      }
    } catch (e) {
      logger.warn('consent-cookie-clear-failed', { error: e.message });
    }

    // Simulate mouse movement to trigger lazy-loaded CMPs
    try {
      await page.mouse.move(100, 100, { steps: 5 });
      await page.mouse.move(300, 300, { steps: 5 });
    } catch (e) {
      // Non-critical — some pages may not support mouse events
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
      const result = await checkViolation(page, violation, debugSessionId, cookies, bannerDetectionStatus.selector);

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

    // Restore desktop viewport if we switched to mobile for banner detection
    if (bannerDetectionStatus.viewport === 'mobile' && bannerDetectionStatus.originalViewport) {
      await page.setViewport(bannerDetectionStatus.originalViewport);
      await new Promise(r => setTimeout(r, 500));
      logger.info('viewport-restored', { viewport: bannerDetectionStatus.originalViewport });
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
async function checkViolation(page, violation, debugSessionId = null, cookies = null, bannerSelector = null) {
  try {
    let result;

    switch (violation.id) {
      case 'type_a':
        result = await checkNoRejectButton(page, violation, bannerSelector);
        break;
      case 'type_b':
        result = await checkPreTickedBoxes(page, violation, bannerSelector);
        break;
      case 'type_c':
        result = await checkDeceptiveLinkDesign(page, violation, bannerSelector);
        break;
      case 'type_d':
        result = await checkDeceptiveButtonColors(page, violation, bannerSelector);
        break;
      case 'type_e':
        result = await checkDeceptiveButtonContrast(page, violation, bannerSelector);
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
async function checkNoRejectButton(page, violation, bannerSelector = null) {
  try {
    // Search for buttons SCOPED to banner container (not entire page)
    const result = await page.evaluate((keywords, selector) => {
      const btnQuery = 'button, a, div[role="button"], span[role="button"]';
      const buttons = [];

      // Scope to banner container if selector is available
      const container = selector ? document.querySelector(selector) : null;
      const searchRoot = container || document;

      buttons.push(...Array.from(searchRoot.querySelectorAll(btnQuery)));

      // Pierce shadow DOM inside the search root
      searchRoot.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          buttons.push(...Array.from(el.shadowRoot.querySelectorAll(btnQuery)));
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

      // Strategy 1: CSS attribute/class selectors
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

      // Strategy 2: Text content matching (multi-language)
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
        scopedTo: container ? selector : 'document'
      };
    }, BUTTON_KEYWORDS, bannerSelector);

    logger.debug('button-detection-results', {
      check: 'Type-A',
      totalButtons: result.totalButtonsFound,
      hasAccept: result.hasAcceptButton,
      acceptText: result.acceptText,
      hasReject: result.hasRejectButton,
      rejectText: result.rejectText,
      scopedTo: result.scopedTo
    });

    // Violation detected if accept button exists but reject button doesn't
    const detected = result.hasAcceptButton && !result.hasRejectButton;

    return {
      detected,
      evidence: detected ? {
        message: 'Accept button found without equally prominent Reject button',
        acceptButton: result.acceptText,
        rejectButton: result.rejectText || 'Not found',
        scopedTo: result.scopedTo,
        totalButtonsInBanner: result.totalButtonsFound
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
async function checkPreTickedBoxes(page, violation, bannerSelector = null) {
  try {
    const result = await page.evaluate((selector) => {
      const container = selector ? document.querySelector(selector) : null;
      const searchRoot = container || document;

      // Collect checkboxes including those inside shadow DOM
      const allChecked = [...searchRoot.querySelectorAll('input[type="checkbox"]:checked')];
      searchRoot.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) allChecked.push(...el.shadowRoot.querySelectorAll('input[type="checkbox"]:checked'));
      });
      const checkedBoxes = allChecked;

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
    }, bannerSelector);

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
async function checkDeceptiveLinkDesign(page, violation, bannerSelector = null) {
  try {
    const result = await page.evaluate((keywords, selector) => {
      const container = selector ? document.querySelector(selector) : null;
      const searchRoot = container || document;
      const btnQuery = 'button, a, div[role="button"]';
      // Find buttons including shadow DOM
      const buttons = [...searchRoot.querySelectorAll(btnQuery)];
      searchRoot.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) buttons.push(...el.shadowRoot.querySelectorAll(btnQuery));
      });
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
    }, BUTTON_KEYWORDS, bannerSelector);

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
async function checkDeceptiveButtonColors(page, violation, bannerSelector = null) {
  try {
    const result = await page.evaluate((data) => {
      const container = data.selector ? document.querySelector(data.selector) : null;
      const searchRoot = container || document;
      const btnQuery = 'button, a, div[role="button"]';
      const buttons = [...searchRoot.querySelectorAll(btnQuery)];
      searchRoot.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) buttons.push(...el.shadowRoot.querySelectorAll(btnQuery));
      });

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
    }, { keywords: BUTTON_KEYWORDS, colorPatterns: violation.color_patterns, selector: bannerSelector });

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
async function checkDeceptiveButtonContrast(page, violation, bannerSelector = null) {
  try {
    const result = await page.evaluate((keywords, selector) => {
      const container = selector ? document.querySelector(selector) : null;
      const searchRoot = container || document;
      const btnQuery = 'button, a, div[role="button"]';
      const buttons = [...searchRoot.querySelectorAll(btnQuery)];
      searchRoot.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) buttons.push(...el.shadowRoot.querySelectorAll(btnQuery));
      });

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
    }, BUTTON_KEYWORDS, bannerSelector);

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
