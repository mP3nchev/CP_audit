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

const { getDatabase } = require('../database/db');

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

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🚀 Starting scan for: ${websiteUrl}`);
    console.log(`📝 Audit ID: ${auditUid}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Step 1: Launch browser
    console.log('📦 Step 1: Launching browser...');
    browser = await launchBrowser();

    // Step 2: Create page with monitoring
    console.log('📄 Step 2: Creating page with monitoring...');
    const page = await createPage(browser);

    // Step 3: Setup network monitoring
    console.log('🌐 Step 3: Setting up network monitoring...');
    const networkMonitor = setupNetworkMonitoring(page);

    // Step 4: Inject tracking detector BEFORE navigation
    console.log('🔍 Step 4: Injecting tracking detector...');
    await injectTrackingDetector(page);

    // Step 5: Navigate to URL
    console.log('🌐 Step 5: Navigating to URL...');
    await navigateToUrl(page, websiteUrl);
    networkMonitor.markPageLoaded();

    // Step 6: Wait for page stability
    console.log('⏳ Step 6: Waiting for page stability...');
    await waitForPageStability(page, 3000);

    // Step 7: Extract cookies
    console.log('🍪 Step 7: Extracting cookies...');
    const cookies = await extractCookies(page);
    const cookieStats = getCookieStats(cookies);
    const trackingCookies = findTrackingCookies(cookies);

    console.log(`   Found ${cookies.length} cookies:`);
    console.log(`   - Essential: ${cookieStats.byCategory.essential || 0}`);
    console.log(`   - Analytics: ${cookieStats.byCategory.analytics || 0}`);
    console.log(`   - Advertising: ${cookieStats.byCategory.advertising || 0}`);
    console.log(`   - Tracking cookies: ${trackingCookies.length}`);

    // Step 8: Get network requests
    console.log('📊 Step 8: Analyzing network requests...');
    const networkStats = networkMonitor.getStats();
    const trackingRequests = networkMonitor.getTrackingRequests();
    const trackingBeforeConsentRequests = networkMonitor.getTrackingBeforeConsent();

    console.log(`   Total requests: ${networkStats.totalRequests}`);
    console.log(`   Tracking requests: ${networkStats.trackingRequests}`);
    console.log(`   Tracking before consent: ${networkStats.trackingBeforeConsent}`);

    // Step 9: Analyze tracking before consent
    console.log('🔬 Step 9: Analyzing tracking before consent...');
    const trackingData = await extractTrackingData(page);
    const trackingAnalysis = analyzeTracking(trackingData, cookies);

    // Step 10: Wait for stable view and capture screenshots
    console.log('📸 Step 10: Capturing screenshots...');
    await waitForStableView(page);
    const screenshots = await captureScreenshots(page);

    // Step 11: Upload screenshots to Vercel Blob
    console.log('☁️  Step 11: Uploading screenshots...');
    const screenshotUrls = await uploadScreenshots(screenshots, auditUid);

    // Step 12: Get page metadata
    const metadata = await getPageMetadata(page);

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
      screenshots: {
        full: screenshotUrls.fullPageUrl,
        banner: screenshotUrls.bannerUrl
      },
      metadata: metadata,
      scanDuration: scanDuration
    };

    // Step 13: Save to database
    console.log('💾 Step 13: Saving results to database...');
    await saveScanResults(auditId, results);

    // Step 14: Close browser
    console.log('🧹 Step 14: Cleaning up...');
    await closeBrowser(browser);

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Scan completed in ${scanDuration}s`);
    console.log(`   Cookies: ${cookies.length}`);
    console.log(`   Tracking before consent: ${results.trackingBeforeConsent ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`   Screenshots uploaded: ${screenshotUrls.fullPageUrl ? 'YES' : 'NO'}`);
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
        screenshot_full_url,
        screenshot_banner_url,
        scan_duration_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      auditId,
      JSON.stringify(results.cookies),
      JSON.stringify(results.networkRequests),
      results.trackingBeforeConsent ? 1 : 0,
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
