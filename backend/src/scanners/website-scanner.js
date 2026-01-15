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
  runConsentSimulation
} = require('./consent-simulator');

const {
  auditConsentMode
} = require('../analyzers/consent-mode-detector');

const {
  buildTimeline,
  enrichCookiesWithTimestamps,
  detectBannerAppearTime,
  generateTimelineReport
} = require('../analyzers/timeline-builder');

const { getDatabase } = require('../database/db');

const constants = require('../config/constants');

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
    await navigateToUrl(page, websiteUrl);
    networkMonitor.markPageLoaded();
    console.log(`   ✅ Navigation completed in ${Date.now() - stepStartTime}ms`);

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

    // Step 7: Extract cookies with timestamps
    stepStartTime = Date.now();
    console.log('🍪 Step 7: Extracting cookies...');
    let cookies = await extractCookies(page);
    cookies = await enrichCookiesWithTimestamps(page, cookies);
    const cookieStats = getCookieStats(cookies);
    const trackingCookies = findTrackingCookies(cookies);

    console.log(`   Found ${cookies.length} cookies:`);
    console.log(`   - Essential: ${cookieStats.byCategory.essential || 0}`);
    console.log(`   - Analytics: ${cookieStats.byCategory.analytics || 0}`);
    console.log(`   - Advertising: ${cookieStats.byCategory.advertising || 0}`);
    console.log(`   - Tracking cookies: ${trackingCookies.length}`);
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

    // Step 11: Wait for stable view and capture screenshots
    stepStartTime = Date.now();
    console.log('📸 Step 11: Capturing screenshots...');
    await waitForStableView(page);
    const screenshots = await captureScreenshots(page);
    console.log(`   ✅ Screenshots captured in ${Date.now() - stepStartTime}ms`);

    // Step 12: Upload screenshots to Vercel Blob
    stepStartTime = Date.now();
    console.log('☁️  Step 12: Uploading screenshots to Vercel Blob...');
    const screenshotUrls = await uploadScreenshots(screenshots, auditUid);
    console.log(`   ✅ Screenshots uploaded in ${Date.now() - stepStartTime}ms`);
    console.log(`   📎 Full page: ${screenshotUrls.fullPageUrl ? 'Uploaded' : 'Failed'}`);
    console.log(`   📎 Banner: ${screenshotUrls.bannerUrl ? 'Uploaded' : 'Failed'}`);

    // Step 13: Get page metadata
    stepStartTime = Date.now();
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

    // Calculate scan duration
    const scanDuration = Math.round((Date.now() - startTime) / 1000);

    // Prepare results
    const results = {
      cookies: cookies,
      cookieStats: cookieStats,
      trackingCookies: trackingCookies,
      networkRequests: networkMonitor.getRequests(),
      trackingRequests: trackingRequests,
      trackingBeforeConsent: trackingAnalysis.trackingBeforeConsent,
      trackingBeforeConsentDetails: trackingAnalysis,
      trackingBeforeConsentCount: trackingBeforeConsentRequests.length + trackingAnalysis.violationCount,
      bannerViolations: bannerAnalysis.violations,
      bannerAnalysis: bannerAnalysis,
      consentModeAudit: consentModeAudit,
      timeline: timeline,
      timelineReport: timelineReport,
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

    // Step 16: Consent Simulation (Accept vs Reject scenarios)
    let consentSimulation = null;
    const enableConsentSim = process.env.ENABLE_CONSENT_SIMULATION !== 'false'; // Enabled by default

    if (enableConsentSim) {
      stepStartTime = Date.now();
      console.log('');
      console.log('🎭 Step 16: Running Accept/Reject consent simulation...');
      try {
        consentSimulation = await runConsentSimulation(websiteUrl);
        console.log(`   ✅ Consent simulation completed in ${Date.now() - stepStartTime}ms`);
        console.log(`   🖱️  Click imbalance: ${consentSimulation.comparison.clickImbalance} extra clicks to reject`);
        console.log(`   ⚠️  Violations found: ${consentSimulation.comparison.violations.length}`);

        // Add consent simulation results to main results
        results.consentSimulation = consentSimulation;
      } catch (error) {
        console.error(`   ⚠️  Consent simulation failed: ${error.message}`);
        // Don't fail the entire scan if simulation fails
        results.consentSimulation = {
          error: error.message,
          success: false
        };
      }
    } else {
      console.log('');
      console.log('⏭️  Step 16: Consent simulation skipped (ENABLE_CONSENT_SIMULATION=false)');
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Scan completed in ${scanDuration}s`);
    console.log(`   Cookies: ${cookies.length}`);
    console.log(`   Tracking before consent: ${results.trackingBeforeConsent ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`   Screenshots uploaded: ${screenshotUrls.fullPageUrl ? 'YES' : 'NO'}`);
    if (consentSimulation && consentSimulation.success !== false) {
      console.log(`   Consent violations: ${consentSimulation.comparison.violations.length}`);
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
    const stmt = db.prepare(`
      INSERT INTO scan_results (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
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
    );

    console.log('✅ Scan results saved to database');
  } catch (error) {
    console.error('❌ Failed to save scan results:', error.message);
    throw error;
  }
}

module.exports = {
  scanWebsite,
  saveScanResults
};
