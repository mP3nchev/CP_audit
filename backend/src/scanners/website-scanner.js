/**
 * Main Website Scanner Orchestrator
 * Coordinates all scanning activities
 */

const {
  launchBrowser,
  createPage,
  navigateToUrl,
  waitForPageStability,
  closeBrowser,
  getPageMetadata
} = require('./puppeteer-setup');

const {
  extractCookies,
  getCookieStats,
  findTrackingCookies
} = require('./cookie-extractor');

const {
  setupNetworkMonitoring
} = require('./network-monitor');

const {
  injectTrackingDetector,
  extractTrackingData,
  analyzeTracking
} = require('./tracking-detector');

const {
  captureScreenshots,
  waitForStableView
} = require('./screenshot-capture');

const {
  uploadScreenshots
} = require('../integrations/blob-storage');

const {
  analyzeCookieBanner
} = require('../analyzers/cookie-banner-checker');

const {
  runAssistedConsentSimulation
} = require('./consent-simulator-v1');

const {
  auditConsentMode
} = require('../analyzers/consent-mode-detector');

const {
  buildTimeline,
  enrichCookiesWithTimestamps,
  detectBannerAppearTime,
  generateTimelineReport
} = require('../analyzers/timeline-builder');

const {
  categorizeRequests,
  getTrackingSummary
} = require('../analyzers/network-request-categorizer');

const {
  calculateOverallScore
} = require('../analyzers/compliance-score-calculator');

const { getDatabase } = require('../database/db');

const constants = require('../config/constants');

/**
 * State machine for audit pipeline
 * Maps progress to explicit states for frontend polling
 */
const AUDIT_STATES = {
  INIT: 'INIT',
  SCANNING: 'SCANNING',
  SCREENSHOTS: 'SCREENSHOTS',
  UPLOADING: 'UPLOADING',
  SIMULATION: 'SIMULATION',
  SCORING: 'SCORING',
  DONE: 'DONE',
  FAILED: 'FAILED'
};

/**
 * Map step number to state
 * @param {number} step - Current step
 * @returns {string} State name
 */
function mapStepToState(step) {
  if (step <= 1) return AUDIT_STATES.INIT;
  if (step <= 10) return AUDIT_STATES.SCANNING;
  if (step <= 11) return AUDIT_STATES.SCREENSHOTS;
  if (step <= 12) return AUDIT_STATES.UPLOADING;
  if (step <= 16) return AUDIT_STATES.SIMULATION;
  if (step <= 17) return AUDIT_STATES.SCORING;
  return AUDIT_STATES.DONE;
}

/**
 * Estimate remaining time based on current step
 * @param {number} step - Current step
 * @param {number} totalSteps - Total steps
 * @param {number} elapsedSeconds - Time elapsed since start
 * @returns {number|null} Estimated seconds remaining
 */
function estimateRemainingTime(step, totalSteps, elapsedSeconds) {
  if (step === 0) return null;

  // Average time per step
  const avgTimePerStep = elapsedSeconds / step;

  // Steps remaining
  const stepsRemaining = totalSteps - step;

  // Estimated time (with buffer for heavier operations)
  const estimated = Math.round(avgTimePerStep * stepsRemaining * 1.2);

  return estimated > 0 ? estimated : null;
}

/**
 * Update scan progress and state in database
 * @param {number} auditId - Audit ID
 * @param {number} currentStep - Current step number
 * @param {number} totalSteps - Total number of steps
 * @param {string} message - Progress message
 * @param {number} startTime - Scan start time (Date.now())
 */
function updateProgress(auditId, currentStep, totalSteps, message, startTime = Date.now()) {
  try {
    const db = getDatabase();
    const now = Date.now();
    const elapsedSeconds = Math.round((now - startTime) / 1000);

    const progress = {
      currentStep,
      totalSteps,
      message,
      percentage: Math.round((currentStep / totalSteps) * 100),
      state: mapStepToState(currentStep),
      estimatedTimeRemaining: estimateRemainingTime(currentStep, totalSteps, elapsedSeconds),
      timestamp: now,
      metadata: {
        currentOperation: message
      }
    };

    db.prepare(`
      UPDATE audits
      SET progress_json = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(progress), auditId);
  } catch (error) {
    console.warn('⚠️  Failed to update progress:', error.message);
  }
}

/**
 * Scan a website for cookies and tracking
 * @param {string} websiteUrl - URL to scan
 * @param {number} auditId - Database audit ID
 * @param {string} auditUid - Audit unique identifier
 * @returns {Promise<Object>} Scan results
 */
async function scanWebsite(websiteUrl, auditId, auditUid) {
  const startTime = Date.now();
  let browser = null;
  let stepStartTime = Date.now();

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🚀 Starting scan for: ${websiteUrl}`);
    console.log(`📝 Audit ID: ${auditUid}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Step 1: Launch browser
    stepStartTime = Date.now();
    console.log('📦 Step 1: Launching browser...');
    browser = await launchBrowser();
    console.log(`   ✅ Browser launched in ${Date.now() - stepStartTime}ms`);

    // Step 2: Create page with monitoring
    stepStartTime = Date.now();
    console.log('📄 Step 2: Creating page with monitoring...');
    const page = await createPage(browser);
    console.log(`   ✅ Page created in ${Date.now() - stepStartTime}ms`);

    // Step 3: Setup network monitoring
    stepStartTime = Date.now();
    console.log('🌐 Step 3: Setting up network monitoring...');
    updateProgress(auditId, 3, 17, 'Setting up network monitoring...', startTime);
    const networkMonitor = setupNetworkMonitoring(page);
    console.log(`   ✅ Network monitoring setup in ${Date.now() - stepStartTime}ms`);

    // Step 4: Inject tracking detector BEFORE navigation
    stepStartTime = Date.now();
    console.log('🔍 Step 4: Injecting tracking detector...');
    await injectTrackingDetector(page);
    console.log(`   ✅ Tracking detector injected in ${Date.now() - stepStartTime}ms`);

    // Step 5: Navigate to URL
    stepStartTime = Date.now();
    console.log('🌐 Step 5: Navigating to URL...');
    updateProgress(auditId, 5, 17, `Loading website: ${websiteUrl}`, startTime);
    await navigateToUrl(page, websiteUrl);
    networkMonitor.markPageLoaded();
    console.log(`   ✅ Navigation completed in ${Date.now() - stepStartTime}ms`);

    // Step 5.5: IMMEDIATE cookie snapshot (NO delay) - captures already loaded cookies
    stepStartTime = Date.now();
    console.log('🍪 Step 5.5: Taking immediate cookie snapshot (baseline)...');
    const baselineCookies = await extractCookies(page, { skipDelay: true }); // NO delay!
    const baselineTime = await page.evaluate(() => performance.now());
    console.log(`   📸 Baseline snapshot: ${baselineCookies.length} cookies at ${(baselineTime / 1000).toFixed(2)}s`);

    // Step 5.7: INTERMEDIATE snapshot AFTER 5s delay - captures async-loaded cookies (_ga, _gcl_au)
    stepStartTime = Date.now();
    console.log('🍪 Step 5.7: Waiting 5s and taking intermediate snapshot (async cookies)...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s for _ga, _gcl_au to load
    const intermediateCookies = await extractCookies(page, { skipDelay: true }); // Immediate after wait
    const intermediateTime = await page.evaluate(() => performance.now());
    console.log(`   📸 Intermediate snapshot: ${intermediateCookies.length} cookies at ${(intermediateTime / 1000).toFixed(2)}s`);

    // Step 6: Wait for page stability
    stepStartTime = Date.now();
    console.log('⏳ Step 6: Waiting for page stability...');
    await waitForPageStability(page, 3000);
    console.log(`   ✅ Page stable after ${Date.now() - stepStartTime}ms`);

    // Step 6.5: Detect cookie banner appearance time
    stepStartTime = Date.now();
    const bannerAppearTime = await detectBannerAppearTime(page);
    if (bannerAppearTime) {
      console.log(`   🍪 Cookie banner detected at ${(bannerAppearTime / 1000).toFixed(2)}s after page load`);
    }

    // Step 7: Extract final cookies (with 3s delay for any remaining async cookies)
    stepStartTime = Date.now();
    console.log('🍪 Step 7: Extracting final cookies and comparing with snapshots...');
    updateProgress(auditId, 7, 17, 'Extracting and analyzing cookies...', startTime);
    let cookies = await extractCookies(page); // WITH delay (default 3s)
    const finalTime = await page.evaluate(() => performance.now());

    // THREE-TIER timestamp assignment:
    // 1. If in baseline → detectedAt = baselineTime (~1.5s)
    // 2. If in intermediate but not baseline → detectedAt = intermediateTime (~6.5s) ← _ga here!
    // 3. If only in final → detectedAt = finalTime (~15s)
    const baselineCookieNames = new Set(baselineCookies.map(c => c.name));
    const intermediateCookieNames = new Set(intermediateCookies.map(c => c.name));

    cookies = cookies.map(cookie => {
      let detectedAt, detectionStage;

      if (baselineCookieNames.has(cookie.name)) {
        detectedAt = baselineTime;
        detectionStage = 'baseline';
      } else if (intermediateCookieNames.has(cookie.name)) {
        detectedAt = intermediateTime; // ← _ga gets THIS timestamp!
        detectionStage = 'intermediate';
      } else {
        detectedAt = finalTime;
        detectionStage = 'final';
      }

      return {
        ...cookie,
        detectedAt: detectedAt,
        detectedAtAbsolute: Date.now(),
        detectionStage: detectionStage,
        loadedBeforeBanner: bannerAppearTime && detectedAt < bannerAppearTime
      };
    });

    const cookieStats = getCookieStats(cookies);
    const trackingCookies = findTrackingCookies(cookies);

    // Count cookies loaded before banner
    const cookiesBeforeBanner = cookies.filter(c => c.loadedBeforeBanner);
    const trackingBeforeBanner = trackingCookies.filter(c => c.loadedBeforeBanner);

    console.log(`   Found ${cookies.length} cookies:`);
    console.log(`   - Essential: ${cookieStats.byCategory.essential || 0}`);
    console.log(`   - Analytics: ${cookieStats.byCategory.analytics || 0}`);
    console.log(`   - Advertising: ${cookieStats.byCategory.advertising || 0}`);
    console.log(`   - Tracking cookies: ${trackingCookies.length}`);
    console.log(`   - Cookies before banner: ${cookiesBeforeBanner.length}`);
    console.log(`   - TRACKING before banner: ${trackingBeforeBanner.length} ⚠️`);
    if (trackingBeforeBanner.length > 0) {
      trackingBeforeBanner.forEach(c => {
        console.log(`      ⚠️  ${c.name} (${c.category})`);
      });
    }
    console.log(`   ✅ Cookie extraction completed in ${Date.now() - stepStartTime}ms`);

    // Step 8: Get network requests
    stepStartTime = Date.now();
    console.log('📊 Step 8: Analyzing network requests...');
    const networkStats = networkMonitor.getStats();
    const trackingRequests = networkMonitor.getTrackingRequests();
    const trackingBeforeConsentRequests = networkMonitor.getTrackingBeforeConsent();

    console.log(`   Total requests: ${networkStats.totalRequests}`);
    console.log(`   Tracking requests: ${networkStats.trackingRequests}`);
    console.log(`   Tracking before consent: ${networkStats.trackingBeforeConsent}`);
    console.log(`   ✅ Network analysis completed in ${Date.now() - stepStartTime}ms`);

    // Step 9: Analyze tracking before consent
    stepStartTime = Date.now();
    console.log('🔬 Step 9: Analyzing tracking before consent...');
    const trackingData = await extractTrackingData(page);
    const trackingAnalysis = analyzeTracking(trackingData, cookies);
    console.log(`   ✅ Tracking analysis completed in ${Date.now() - stepStartTime}ms`);

    // Step 10: Analyze cookie banner for NOYB violations
    stepStartTime = Date.now();
    console.log('⚖️  Step 10: Analyzing cookie banner for GDPR violations...');
    updateProgress(auditId, 10, 17, 'Analyzing cookie banner compliance (NOYB checklist)...', startTime);
    const bannerAnalysis = await analyzeCookieBanner(page);
    console.log(`   ✅ Banner analysis completed in ${Date.now() - stepStartTime}ms`);
    console.log(`   📋 Violations found: ${bannerAnalysis.violationCount}/${bannerAnalysis.totalChecks}`);
    console.log(`   ⚠️  Critical violations: ${bannerAnalysis.hasCriticalViolations ? 'YES' : 'NO'}`);

    // Step 10.5: Audit Google Consent Mode v2
    stepStartTime = Date.now();
    console.log('🎯 Step 10.5: Checking Google Consent Mode v2...');
    const consentModeAudit = await auditConsentMode(page);
    console.log(`   ✅ Consent Mode audit completed in ${Date.now() - stepStartTime}ms`);
    if (consentModeAudit.detected) {
      console.log(`   📊 Version: ${consentModeAudit.version || 'unknown'}`);
      console.log(`   ${consentModeAudit.compliant ? '✅' : '⚠️'}  GDPR Compliance: ${consentModeAudit.compliant ? 'YES' : 'NO'}`);
    } else {
      console.log(`   ⚠️  Consent Mode not detected`);
    }

    // Step 11 & 12: Screenshots (HARD DISABLED - temporary)
    // CRITICAL: Do NOT execute screenshot code to prevent 2.5min blocking
    let screenshotUrls = {};
    console.log('⏭️  Step 11-12: Screenshots DISABLED (temporary) - skipping to maintain fast audit loop');

    // FUTURE: When screenshots are re-enabled, uncomment below with proper safeguards:
    // - protocolTimeout must be lowered (done: 10s)
    // - Promise.race must use AbortController for real cancellation
    // - Sequential selector loops must be replaced with Promise.race(selectors)
    // - Image loading checks must be removed from waitForStableView
    /*
    if (constants.ENABLE_SCREENSHOTS) {
      stepStartTime = Date.now();
      console.log('📸 Step 11: Capturing screenshots...');
      await waitForStableView(page);
      const screenshots = await captureScreenshots(page);
      console.log(`   ✅ Screenshots captured in ${Date.now() - stepStartTime}ms`);

      stepStartTime = Date.now();
      console.log('☁️  Step 12: Uploading screenshots to Vercel Blob...');
      screenshotUrls = await uploadScreenshots(screenshots, auditUid);
      console.log(`   ✅ Screenshots uploaded in ${Date.now() - stepStartTime}ms`);
      console.log(`   📎 Full page: ${screenshotUrls.fullPageUrl ? 'Uploaded' : 'Failed'}`);
      console.log(`   📎 Banner: ${screenshotUrls.bannerUrl ? 'Uploaded' : 'Failed'}`);
    }
    */

    // Step 13: Get page metadata
    stepStartTime = Date.now();
    updateProgress(auditId, 13, 17, 'Building request timeline and capturing screenshots...', startTime);
    const metadata = await getPageMetadata(page);
    console.log(`   ✅ Metadata extracted in ${Date.now() - stepStartTime}ms`);

    // Step 13.5: Build timeline
    stepStartTime = Date.now();
    console.log('⏱️  Step 13.5: Building request timeline...');
    const pageLoadTime = await page.evaluate(() => {
      return performance.timing.loadEventEnd - performance.timing.navigationStart;
    });

    const timeline = buildTimeline({
      cookies: cookies,
      networkRequests: networkMonitor.getRequests(),
      pageLoadTime: pageLoadTime,
      bannerAppearTime: bannerAppearTime,
      consentTime: null // We don't track user consent click yet
    });

    const timelineReport = generateTimelineReport(timeline);
    console.log(`   ✅ Timeline built in ${Date.now() - stepStartTime}ms`);
    console.log(`   📊 Events: ${timeline.events.length}, Violations: ${timeline.violations.length}`);
    console.log(`   ⚠️  Before consent: ${timelineReport.beforeConsent.cookies} cookies, ${timelineReport.beforeConsent.requests} requests`);

    // Step 13.6: Categorize network requests (Problem 5)
    stepStartTime = Date.now();
    console.log('🔍 Step 13.6: Categorizing network requests...');
    const requestCategorization = categorizeRequests(networkMonitor.getRequests());
    const trackingSummary = getTrackingSummary(requestCategorization);
    console.log(`   ✅ Categorization completed in ${Date.now() - stepStartTime}ms`);
    console.log(`   📊 Definite tracking: ${requestCategorization.categoryA.count}`);
    console.log(`   📊 Suspicious: ${requestCategorization.categoryB.count}`);
    console.log(`   📊 Benign: ${requestCategorization.categoryC.count}`);
    if (Object.keys(requestCategorization.vendorBreakdown).length > 0) {
      console.log(`   📊 Top vendors: ${Object.keys(requestCategorization.vendorBreakdown).slice(0, 3).join(', ')}`);
    }

    // Calculate scan duration
    const scanDuration = Math.round((Date.now() - startTime) / 1000);

    // Prepare detailed tracking before consent data for frontend
    const trackingBeforeConsentDetailed = {
      networkRequests: trackingBeforeConsentRequests.map(req => ({
        type: 'network',
        name: req.domain || new URL(req.url).hostname,
        url: req.url,
        method: req.method,
        resourceType: req.resourceType,
        timestamp: req.timestamp,
        category: 'tracking'
      })),
      cookies: trackingAnalysis.identifiedTrackers
        .filter(t => t.type === 'cookie')
        .map(t => ({
          type: 'cookie',
          name: t.name,
          value: t.value?.substring(0, 20) + '...',
          timestamp: t.timestamp,
          category: 'tracking'
        })),
      localStorage: trackingAnalysis.identifiedTrackers
        .filter(t => t.type === 'localStorage')
        .map(t => ({
          type: 'localStorage',
          name: t.name,
          value: t.value?.substring(0, 20) + '...',
          timestamp: t.timestamp,
          category: 'tracking'
        })),
      indexedDB: trackingAnalysis.identifiedTrackers
        .filter(t => t.type === 'indexedDB')
        .map(t => ({
          type: 'indexedDB',
          name: t.name,
          timestamp: t.timestamp,
          category: 'tracking'
        })),
      total: trackingBeforeConsentRequests.length + trackingAnalysis.violationCount
    };

    // Prepare results
    const results = {
      cookies: cookies,
      cookieStats: cookieStats,
      trackingCookies: trackingCookies,
      networkRequests: networkMonitor.getRequests(),
      trackingRequests: trackingRequests,
      trackingBeforeConsent: trackingAnalysis.trackingBeforeConsent,
      trackingBeforeConsentDetails: trackingAnalysis,
      trackingBeforeConsentDetailed: trackingBeforeConsentDetailed,
      trackingBeforeConsentCount: trackingBeforeConsentRequests.length + trackingAnalysis.violationCount,
      bannerViolations: bannerAnalysis.violations,
      bannerAnalysis: bannerAnalysis,
      consentModeAudit: consentModeAudit,
      timeline: timeline,
      timelineReport: timelineReport,
      requestCategorization: requestCategorization,
      trackingSummary: trackingSummary,
      screenshots: {
        full: screenshotUrls.fullPageUrl,
        banner: screenshotUrls.bannerUrl
      },
      metadata: metadata,
      scanDuration: scanDuration
    };

    // Step 14: Save to database
    console.log('💾 Step 14: Saving results to database...');
    await saveScanResults(auditId, results);

    // Step 15: Close browser
    console.log('🧹 Step 15: Cleaning up...');
    await closeBrowser(browser);

    // Step 16: Consent Simulation (Human-Assisted Accept vs Reject)
    let consentSimulation = null;
    stepStartTime = Date.now();
    console.log('');
    console.log('🎭 Step 16: Running human-assisted consent simulation...');
    updateProgress(auditId, 16, 17, 'Consent simulation (human-assisted)...', startTime);

    try {
      consentSimulation = await runAssistedConsentSimulation(websiteUrl);

      if (consentSimulation.skipped) {
        console.log(`   ⏭️  Consent simulation skipped: ${consentSimulation.reason}`);
      } else {
        console.log(`   ✅ Consent simulation completed in ${consentSimulation.duration}s`);
        if (consentSimulation.comparison) {
          console.log(`   🍪 New cookies after Accept: ${consentSimulation.comparison.cookies.newAfterAccept.length}`);
          console.log(`   📡 New tracking domains after Accept: ${consentSimulation.comparison.network.newDomainsAfterAccept.length}`);
        }
      }

      // Add consent simulation results to main results
      results.consentSimulation = consentSimulation;
    } catch (error) {
      console.error(`   ⚠️  Consent simulation failed: ${error.message}`);
      // Don't fail the entire scan if simulation fails
      results.consentSimulation = {
        error: error.message,
        skipped: false,
        rejectScenario: { success: false },
        acceptScenario: { success: false }
      };
    }

    // Step 17: Calculate overall compliance score (Problem 7)
    stepStartTime = Date.now();
    console.log('');
    console.log('📊 Step 17: Calculating overall compliance score...');
    updateProgress(auditId, 17, 17, 'Calculating compliance score and finalizing report...', startTime);
    const complianceScore = calculateOverallScore(results);
    results.complianceScore = complianceScore;
    console.log(`   ✅ Compliance score calculated in ${Date.now() - stepStartTime}ms`);
    console.log(`   📊 Overall Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`);
    console.log(`   📋 Components:`);
    console.log(`      - Privacy Policy: ${complianceScore.components.privacyPolicy?.score ?? 0}/100`);
    console.log(`      - Cookie Banner: ${complianceScore.components.cookieBanner?.score ?? 0}/100`);
    console.log(`      - Technical: ${complianceScore.components.technical?.score ?? 0}/100`);
    console.log(`      - Cookie Policy: ${complianceScore.components.cookiePolicy?.score ?? 0}/100`);
    if (complianceScore.capsApplied.length > 0) {
      console.log(`   ⚠️  Score caps applied: ${complianceScore.capsApplied.join(', ')}`);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Scan completed in ${scanDuration}s`);
    console.log(`   Cookies: ${cookies.length}`);
    console.log(`   Tracking before consent: ${results.trackingBeforeConsent ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`   Compliance Score: ${complianceScore.overallScore}/100 (Grade: ${complianceScore.grade})`);
    console.log(`   Screenshots uploaded: ${screenshotUrls.fullPageUrl ? 'YES' : 'NO'}`);
    if (consentSimulation && !consentSimulation.skipped && consentSimulation.comparison) {
      console.log(`   Consent simulation: ${consentSimulation.comparison.cookies.newAfterAccept.length} new cookies after Accept`);
    } else if (consentSimulation && consentSimulation.skipped) {
      console.log(`   Consent simulation: SKIPPED (${consentSimulation.reason})`);
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    return results;

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════');
    console.error('❌ Scan failed:', error.message);
    console.error('═══════════════════════════════════════════════════════');
    console.error('');

    // Close browser if still open
    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }

    throw error;
  }
}

/**
 * Save scan results to database
 * @param {number} auditId - Audit ID
 * @param {Object} results - Scan results
 */
async function saveScanResults(auditId, results) {
  const db = getDatabase();

  try {
    // Check if new columns exist
    const tableInfo = db.prepare("PRAGMA table_info(scan_results)").all();
    const columnNames = tableInfo.map(col => col.name);
    const hasComplianceScore = columnNames.includes('compliance_score_json');
    const hasRequestCategorization = columnNames.includes('request_categorization_json');
    const hasConsentSimulation = columnNames.includes('consent_simulation_json');

    // Build dynamic INSERT statement based on available columns
    let insertColumns = `
      audit_id,
      cookies_json,
      network_requests_json,
      tracking_before_consent,
      banner_violations_json,
      consent_mode_v2_status,
      timeline_json,
      screenshot_full_url,
      screenshot_banner_url,
      scan_duration_seconds
    `;
    let insertPlaceholders = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
    const insertValues = [
      auditId,
      JSON.stringify(results.cookies),
      JSON.stringify(results.networkRequests),
      results.trackingBeforeConsent ? 1 : 0,
      JSON.stringify(results.bannerViolations || []),
      JSON.stringify(results.consentModeAudit || {}),
      JSON.stringify(results.timelineReport || {}),
      results.screenshots.full || null,
      results.screenshots.banner || null,
      results.scanDuration
    ];

    if (hasComplianceScore) {
      insertColumns += ',\n      compliance_score_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.complianceScore || {}));
    }

    if (hasRequestCategorization) {
      insertColumns += ',\n      request_categorization_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.trackingSummary || {}));
    }

    if (hasConsentSimulation) {
      insertColumns += ',\n      consent_simulation_json';
      insertPlaceholders += ', ?';
      insertValues.push(JSON.stringify(results.consentSimulation || {}));
    }

    const stmt = db.prepare(`
      INSERT INTO scan_results (
        ${insertColumns}
      ) VALUES (${insertPlaceholders})
    `);

    stmt.run(...insertValues);

    // Update audits table with overall score
    if (results.complianceScore) {
      try {
        const updateStmt = db.prepare(`
          UPDATE audits
          SET overall_score = ?,
              score_grade = ?
          WHERE id = ?
        `);

        updateStmt.run(
          results.complianceScore.overallScore,
          results.complianceScore.grade,
          auditId
        );
      } catch (scoreUpdateError) {
        console.warn('⚠️  Could not update overall_score in audits table (columns may not exist yet)');
      }
    }

    console.log('✅ Scan results saved to database');
  } catch (error) {
    console.error('❌ Failed to save scan results:', error.message);
    console.error('   Full error:', error);
    throw error;
  }
}

module.exports = {
  scanWebsite,
  saveScanResults
};
