const { put } = require('@vercel/blob');
const { retryBlobUpload } = require('../utils/retry-handler');
const constants = require('../config/constants');
const crypto = require('crypto');

const BLOB_SIGNING_SECRET = process.env.BLOB_SIGNING_SECRET;
const SCREENSHOT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Upload screenshot to Vercel Blob storage
 * @param {Buffer} buffer - Image buffer
 * @param {string} filename - File name (e.g., 'audit_123_full.png')
 * @returns {Promise<string>} Public URL of uploaded file
 */
async function uploadScreenshot(buffer, filename) {
  if (!process.env.VERCEL_BLOB_TOKEN) {
    throw new Error('VERCEL_BLOB_TOKEN not configured');
  }

  const uploadFn = async () => {
    const blob = await put(filename, buffer, {
      access: 'public',
      token: process.env.VERCEL_BLOB_TOKEN
    });

    return blob.url;
  };

  try {
    const url = await retryBlobUpload(uploadFn, filename);
    console.log(`✅ Uploaded screenshot: ${filename} → ${url}`);
    return url;
  } catch (error) {
    console.error(`❌ Failed to upload screenshot ${filename}:`, error.message);
    throw new Error(constants.ERROR_CODES.BLOB_UPLOAD_FAILED.message);
  }
}

/**
 * Upload multiple screenshots
 * @param {Object} screenshots - Object with screenshot buffers
 * @param {Buffer} screenshots.full - Full page screenshot
 * @param {Buffer} screenshots.banner - Cookie banner screenshot
 * @param {string} auditUid - Audit unique ID
 * @returns {Promise<Object>} URLs for both screenshots
 */
async function uploadScreenshots(screenshots, auditUid) {
  const results = {};

  // Handle disabled/failed screenshots gracefully
  if (!screenshots) {
    console.log('⏭️  No screenshots to upload (disabled or failed)');
    return results;
  }

  try {
    // Upload full page screenshot
    if (screenshots.full) {
      results.fullPageUrl = await uploadScreenshot(
        screenshots.full,
        `audit_${auditUid}_full.png`
      );
    }

    // Upload cookie banner screenshot
    if (screenshots.banner) {
      results.bannerUrl = await uploadScreenshot(
        screenshots.banner,
        `audit_${auditUid}_banner.png`
      );
    }

    return results;
  } catch (error) {
    console.error('❌ Failed to upload screenshots:', error);
    throw error;
  }
}

/**
 * Upload any file to Vercel Blob storage (generic function)
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - File name with extension
 * @param {Object} options - Upload options
 * @returns {Promise<string>} Public URL of uploaded file
 */
async function uploadBlob(buffer, filename, options = {}) {
  if (!process.env.VERCEL_BLOB_TOKEN) {
    throw new Error('VERCEL_BLOB_TOKEN not configured');
  }

  const uploadFn = async () => {
    const blob = await put(filename, buffer, {
      access: 'public',
      token: process.env.VERCEL_BLOB_TOKEN,
      ...options
    });

    return blob.url;
  };

  try {
    const url = await retryBlobUpload(uploadFn, filename);
    console.log(`✅ Uploaded file: ${filename} → ${url}`);
    return url;
  } catch (error) {
    console.error(`❌ Failed to upload file ${filename}:`, error.message);
    throw new Error(constants.ERROR_CODES.BLOB_UPLOAD_FAILED.message);
  }
}

/**
 * Test blob storage connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testBlobConnection() {
  try {
    if (!process.env.VERCEL_BLOB_TOKEN) {
      console.log('⚠️  VERCEL_BLOB_TOKEN not configured - blob storage unavailable');
      return false;
    }

    // Upload a small test file
    const testBuffer = Buffer.from('test');
    const testFilename = `test_${Date.now()}.txt`;

    const url = await uploadScreenshot(testBuffer, testFilename);
    console.log(`✅ Blob storage connection successful: ${url}`);

    return true;
  } catch (error) {
    console.error('❌ Blob storage connection failed:', error.message);
    return false;
  }
}

/**
 * Generate a time-limited signed token for screenshot access.
 * The proxy endpoint uses this — blob URL never sent to client directly.
 */
function generateScreenshotToken(auditUid, screenshotType) {
  if (!BLOB_SIGNING_SECRET) throw new Error('BLOB_SIGNING_SECRET not configured');
  const expires = Date.now() + SCREENSHOT_TOKEN_TTL_MS;
  const payload = `${auditUid}:${screenshotType}:${expires}`;
  const sig = crypto.createHmac('sha256', BLOB_SIGNING_SECRET).update(payload).digest('hex');
  return { token: sig, expires };
}

function verifyScreenshotToken(auditUid, screenshotType, expires, token) {
  if (!BLOB_SIGNING_SECRET) return false;
  if (Date.now() > parseInt(expires)) return false;
  const payload = `${auditUid}:${screenshotType}:${expires}`;
  const expected = crypto.createHmac('sha256', BLOB_SIGNING_SECRET).update(payload).digest('hex');
  const a = Buffer.from(token, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  uploadScreenshot,
  uploadScreenshots,
  uploadBlob,
  testBlobConnection,
  generateScreenshotToken,
  verifyScreenshotToken
};
