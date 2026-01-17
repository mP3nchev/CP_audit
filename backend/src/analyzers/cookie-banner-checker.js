const noybViolations = require('../config/noyb-violations.json');

/**
 * Multi-language keyword sets for cookie banner detection
 */
const BUTTON_KEYWORDS = {
  accept: ['accept', 'agree', 'allow', 'ok', 'yes', 'akzeptieren', 'zustimmen', 'accepter', 'aceptar', 'accetto', 'aceitar', 'приемам', 'acceptuj', 'souhlasím'],
  reject: ['reject', 'decline', 'deny', 'refuse', 'ablehnen', 'refuser', 'rechazar', 'rifiuto', 'rejeitar', 'отказвам', 'odrzuć', 'odmítnout'],
  settings: ['settings', 'customize', 'preferences', 'manage', 'options', 'einstellungen', 'anpassen', 'préférences', 'configuración', 'impostazioni', 'configurações', 'настройки', 'ustawienia', 'nastavení'],
  cookieSettings: ['cookie settings', 'privacy settings', 'manage cookies', 'cookie preferences', 'cookie-einstellungen', 'cookies verwalten', 'gestion des cookies', 'configuración de cookies', 'gestione cookie', 'configurações de cookies', 'настройки за бисквитки', 'zarządzaj cookie']
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
 * Analyze cookie banner for noyb 8-point checklist violations
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Object>} Violations detected
 */
async function analyzeCookieBanner(page) {
  try {
    console.log('🔍 Analyzing cookie banner for noyb violations...');

    const violations = [];
    const passedChecks = [];

    // Check each violation type
    for (const violation of noybViolations.violations) {
      const result = await checkViolation(page, violation);

      if (result.detected) {
        violations.push({
          id: violation.id,
          name: violation.name,
          severity: violation.severity,
          description: violation.description,
          legal_basis: violation.legal_basis,
          evidence: result.evidence
        });
        console.log(`  ❌ ${violation.id.toUpperCase()}: ${violation.name}`);
      } else {
        passedChecks.push({
          id: violation.id,
          name: violation.name
        });
        console.log(`  ✅ ${violation.id.toUpperCase()}: Passed`);
      }
    }

    const totalChecks = noybViolations.violations.length;
    const passedCount = passedChecks.length;
    const violationCount = violations.length;
    const compliancePercentage = Math.round((passedCount / totalChecks) * 100);

    console.log(`✅ Banner analysis complete: ${passedCount}/${totalChecks} checks passed (${compliancePercentage}%)`);

    return {
      violations,
      passedChecks,
      totalChecks,
      passedCount,
      violationCount,
      compliancePercentage,
      hasCriticalViolations: violations.some(v => v.severity === 'critical')
    };
  } catch (error) {
    console.error('❌ Cookie banner analysis failed:', error.message);
    throw error;
  }
}

/**
 * Check individual violation
 * @param {Page} page - Puppeteer page
 * @param {Object} violation - Violation definition
 * @returns {Promise<Object>} Detection result
 */
async function checkViolation(page, violation) {
  switch (violation.id) {
    case 'type_a':
      return checkNoRejectButton(page, violation);
    case 'type_b':
      return checkPreTickedBoxes(page, violation);
    case 'type_c':
      return checkDeceptiveLinkDesign(page, violation);
    case 'type_d':
      return checkDeceptiveButtonColors(page, violation);
    case 'type_e':
      return checkDeceptiveButtonContrast(page, violation);
    case 'type_h':
      return checkLegitimateInterestForAds(page, violation);
    case 'type_i':
      return checkMisclassifiedEssentialCookies(page, violation);
    case 'type_k':
      return checkDifficultConsentWithdrawal(page, violation);
    default:
      return { detected: false, evidence: null };
  }
}

/**
 * Type A: No Reject Button on First Layer
 */
async function checkNoRejectButton(page, violation) {
  try {
    const result = await page.evaluate((keywords) => {
      // Hybrid approach: Try CSS selectors first, then text matching
      const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));

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
          const text = b.textContent.toLowerCase().trim();
          return keywords.accept.some(keyword => text.includes(keyword.toLowerCase()));
        });
      }

      // Find reject button using multiple strategies
      let rejectButton = null;

      // Strategy 1: CSS attribute/class selectors (only valid selectors from noyb config)
      rejectButton = buttons.find(b =>
        b.getAttribute('data-action') === 'reject' ||
        b.getAttribute('data-action') === 'deny' ||
        b.getAttribute('id')?.includes('reject') ||
        b.className?.includes('reject') ||
        b.className?.includes('decline')
      );

      // Strategy 2: Text content matching (multi-language)
      if (!rejectButton) {
        rejectButton = buttons.find(b => {
          const text = b.textContent.toLowerCase().trim();
          return keywords.reject.some(keyword => text.includes(keyword.toLowerCase()));
        });
      }

      return {
        hasAcceptButton: !!acceptButton,
        hasRejectButton: !!rejectButton,
        acceptText: acceptButton?.textContent.trim(),
        rejectText: rejectButton?.textContent.trim()
      };
    }, BUTTON_KEYWORDS);

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
    console.error('Type A check failed:', error.message);
    return { detected: false, evidence: null };
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
    console.error('Type B check failed:', error.message);
    return { detected: false, evidence: null };
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
    console.error('Type C check failed:', error.message);
    return { detected: false, evidence: null };
  }
}

/**
 * Type D: Deceptive Button Colors
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

      // Convert rgb to hex
      const rgbToHex = (rgb) => {
        const match = rgb.match(/\d+/g);
        if (!match) return null;
        return '#' + match.map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
      };

      return {
        hasButtons: true,
        acceptColor: rgbToHex(acceptBg),
        rejectColor: rgbToHex(rejectBg)
      };
    }, { keywords: BUTTON_KEYWORDS, colorPatterns: violation.color_patterns });

    if (!result.hasButtons) {
      return { detected: false, evidence: null };
    }

    // Check if accept uses attractive color and reject uses muted color
    const acceptIsAttractive = violation.color_patterns.accept_attractive.some(color =>
      result.acceptColor?.toLowerCase() === color.toLowerCase()
    );

    const rejectIsMuted = violation.color_patterns.reject_muted.some(color =>
      result.rejectColor?.toLowerCase() === color.toLowerCase()
    );

    const detected = acceptIsAttractive && rejectIsMuted;

    return {
      detected,
      evidence: detected ? {
        message: 'Accept button uses attractive color while Reject is muted',
        acceptColor: result.acceptColor,
        rejectColor: result.rejectColor
      } : null
    };
  } catch (error) {
    console.error('Type D check failed:', error.message);
    return { detected: false, evidence: null };
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
    console.error('Type E check failed:', error.message);
    return { detected: false, evidence: null };
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
    console.error('Type H check failed:', error.message);
    return { detected: false, evidence: null };
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
      return { detected: false, evidence: null };
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
    console.error('Type I check failed:', error.message);
    return { detected: false, evidence: null };
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
    console.error('Type K check failed:', error.message);
    return { detected: false, evidence: null };
  }
}

module.exports = {
  analyzeCookieBanner,
  checkMisclassifiedEssentialCookies
};
