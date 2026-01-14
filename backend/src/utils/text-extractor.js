const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const cheerio = require('cheerio');

/**
 * Text extraction utilities for Privacy Policy documents
 * Supports: PDF, DOCX, HTML
 */

/**
 * Extract text from PDF file
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} Extracted text
 */
async function extractFromPDF(filePath) {
  try {
    console.log(`📄 Extracting text from PDF: ${path.basename(filePath)}`);

    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    const text = data.text.trim();
    const pageCount = data.numpages;

    console.log(`✅ PDF extracted: ${pageCount} pages, ${text.length} characters`);

    if (text.length < 100) {
      throw new Error('PDF appears to be empty or unreadable');
    }

    return text;
  } catch (error) {
    console.error('❌ PDF extraction failed:', error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

/**
 * Extract text from DOCX file
 * @param {string} filePath - Path to DOCX file
 * @returns {Promise<string>} Extracted text
 */
async function extractFromDOCX(filePath) {
  try {
    console.log(`📝 Extracting text from DOCX: ${path.basename(filePath)}`);

    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value.trim();

    if (result.messages.length > 0) {
      console.log('⚠️  DOCX extraction warnings:', result.messages.length);
    }

    console.log(`✅ DOCX extracted: ${text.length} characters`);

    if (text.length < 100) {
      throw new Error('DOCX appears to be empty or unreadable');
    }

    return text;
  } catch (error) {
    console.error('❌ DOCX extraction failed:', error.message);
    throw new Error(`Failed to extract text from DOCX: ${error.message}`);
  }
}

/**
 * Extract text from HTML file
 * @param {string} filePath - Path to HTML file
 * @returns {Promise<string>} Extracted text
 */
async function extractFromHTML(filePath) {
  try {
    console.log(`🌐 Extracting text from HTML: ${path.basename(filePath)}`);

    const html = fs.readFileSync(filePath, 'utf8');
    const $ = cheerio.load(html);

    // Remove script and style elements
    $('script').remove();
    $('style').remove();
    $('noscript').remove();

    // Get text content
    let text = $('body').text();

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')  // Multiple spaces to single space
      .replace(/\n+/g, '\n') // Multiple newlines to single newline
      .trim();

    console.log(`✅ HTML extracted: ${text.length} characters`);

    if (text.length < 100) {
      throw new Error('HTML appears to be empty or unreadable');
    }

    return text;
  } catch (error) {
    console.error('❌ HTML extraction failed:', error.message);
    throw new Error(`Failed to extract text from HTML: ${error.message}`);
  }
}

/**
 * Extract text from file based on extension
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Extracted text
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await extractFromPDF(filePath);

    case '.docx':
      return await extractFromDOCX(filePath);

    case '.html':
    case '.htm':
      return await extractFromHTML(filePath);

    default:
      throw new Error(`Unsupported file type: ${ext}. Supported: .pdf, .docx, .html`);
  }
}

/**
 * Extract text from uploaded file buffer
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromBuffer(buffer, filename) {
  // Create temporary file
  const tempDir = path.join(__dirname, '../../tmp');

  // Ensure tmp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFile = path.join(tempDir, `${Date.now()}_${filename}`);

  try {
    // Write buffer to temp file
    fs.writeFileSync(tempFile, buffer);

    // Extract text
    const text = await extractText(tempFile);

    // Clean up temp file
    fs.unlinkSync(tempFile);

    return text;
  } catch (error) {
    // Clean up temp file on error
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

/**
 * Validate file type
 * @param {string} filename - File name
 * @returns {boolean} True if valid file type
 */
function isValidFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.pdf', '.docx', '.html', '.htm'].includes(ext);
}

/**
 * Get file type from extension
 * @param {string} filename - File name
 * @returns {string} File type
 */
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();

  switch (ext) {
    case '.pdf':
      return 'PDF';
    case '.docx':
      return 'DOCX';
    case '.html':
    case '.htm':
      return 'HTML';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Clean and normalize extracted text
 * @param {string} text - Raw extracted text
 * @returns {string} Cleaned text
 */
function cleanText(text) {
  return text
    // Normalize whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    // Remove multiple spaces
    .replace(/ +/g, ' ')
    // Remove multiple newlines (keep max 2)
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
}

module.exports = {
  extractText,
  extractFromPDF,
  extractFromDOCX,
  extractFromHTML,
  extractTextFromBuffer,
  isValidFileType,
  getFileType,
  cleanText
};
