const puppeteer = require('puppeteer');
const constants = require('../config/constants');

/**
 * React Report Renderer - Headless Chromium Static Export
 *
 * Renders the React v2 report to static HTML/PDF using Puppeteer.
 * This replaces the legacy Handlebars template approach with a modern,
 * maintainable solution that leverages the React v2 report components.
 *
 * Railway Compatibility:
 * - Uses 'new' headless mode (Puppeteer v23+)
 * - Includes --no-sandbox for containerized environments
 * - Configurable timeout and resource limits
 */

const RENDER_TIMEOUT_MS = parseInt(process.env.REPORT_RENDER_TIMEOUT_MS) || 60000;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';

/**
 * Launch Puppeteer browser with Railway-compatible settings
 * @returns {Promise<Browser>}
 */
async function launchBrowser() {
  const launchOptions = {
    headless: 'new', // Use new headless mode (Puppeteer v23+)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Overcome limited resource problems
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  };

  // On Railway/production, use specific executable path if needed
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  return await puppeteer.launch(launchOptions);
}

/**
 * Render React v2 report to PDF
 * @param {string} auditUid - Audit unique identifier
 * @param {Object} options - Rendering options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function renderReactReportToPDF(auditUid, options = {}) {
  const startTime = Date.now();
  let browser = null;

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('📄 Starting React Report → PDF Rendering');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   Audit: ${auditUid}`);
    console.log(`   Timeout: ${RENDER_TIMEOUT_MS}ms`);

    // Launch browser
    browser = await launchBrowser();
    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2 // Higher quality for PDF
    });

    // Navigate to React v2 report
    const reportUrl = `${FRONTEND_BASE_URL}/report-v2/${auditUid}`;
    console.log(`   Loading: ${reportUrl}`);

    await page.goto(reportUrl, {
      waitUntil: 'networkidle0', // Wait for all network requests to finish
      timeout: RENDER_TIMEOUT_MS
    });

    // Wait for report content to fully render
    await page.waitForSelector('[data-report-ready="true"]', {
      timeout: 10000
    }).catch(() => {
      console.warn('⚠️  Report ready indicator not found - proceeding anyway');
    });

    // Generate PDF with A4 settings
    console.log('   Generating PDF...');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true, // Include background colors/images
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      preferCSSPageSize: false, // Use our A4 format
      displayHeaderFooter: false,
      ...options.pdfOptions
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const sizeKB = (pdfBuffer.length / 1024).toFixed(2);

    console.log('');
    console.log('✅ PDF Generation Successful');
    console.log(`   Size: ${sizeKB} KB`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    return pdfBuffer;

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('');
    console.error('❌ PDF Rendering Failed');
    console.error(`   Error: ${error.message}`);
    console.error(`   Duration: ${duration}s`);
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Render React v2 report to static HTML
 * @param {string} auditUid - Audit unique identifier
 * @param {Object} options - Rendering options
 * @returns {Promise<string>} HTML content
 */
async function renderReactReportToHTML(auditUid, options = {}) {
  const startTime = Date.now();
  let browser = null;

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('📄 Starting React Report → HTML Rendering');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   Audit: ${auditUid}`);
    console.log(`   Timeout: ${RENDER_TIMEOUT_MS}ms`);

    // Launch browser
    browser = await launchBrowser();
    const page = await browser.newPage();

    // Set viewport
    await page.setViewport({
      width: 1200,
      height: 1600
    });

    // Navigate to React v2 report
    const reportUrl = `${FRONTEND_BASE_URL}/report-v2/${auditUid}`;
    console.log(`   Loading: ${reportUrl}`);

    await page.goto(reportUrl, {
      waitUntil: 'networkidle0',
      timeout: RENDER_TIMEOUT_MS
    });

    // Wait for report content to fully render
    await page.waitForSelector('[data-report-ready="true"]', {
      timeout: 10000
    }).catch(() => {
      console.warn('⚠️  Report ready indicator not found - proceeding anyway');
    });

    // Get fully rendered HTML
    console.log('   Extracting HTML...');
    const htmlContent = await page.content();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const sizeKB = (htmlContent.length / 1024).toFixed(2);

    console.log('');
    console.log('✅ HTML Rendering Successful');
    console.log(`   Size: ${sizeKB} KB`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    return htmlContent;

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('');
    console.error('❌ HTML Rendering Failed');
    console.error(`   Error: ${error.message}`);
    console.error(`   Duration: ${duration}s`);
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Test React report rendering (health check)
 * @returns {Promise<boolean>} True if rendering works
 */
async function testReactReportRendering() {
  try {
    console.log('🧪 Testing React report rendering...');

    const browser = await launchBrowser();
    const page = await browser.newPage();

    // Test if we can launch Chromium and load a simple page
    await page.goto('about:blank', { timeout: 5000 });
    await browser.close();

    console.log('✅ React report rendering test passed');
    return true;
  } catch (error) {
    console.error('❌ React report rendering test failed:', error.message);
    return false;
  }
}

module.exports = {
  renderReactReportToPDF,
  renderReactReportToHTML,
  testReactReportRendering
};
