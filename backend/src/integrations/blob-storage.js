const { put } = require('@vercel/blob');
const { retryBlobUpload } = require('../utils/retry-handler');
const constants = require('../config/constants');

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

module.exports = {
  uploadScreenshot,
  uploadScreenshots,
  uploadBlob,
  testBlobConnection
};
