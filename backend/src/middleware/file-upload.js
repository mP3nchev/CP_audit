const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * File upload middleware using multer
 * Handles PDF, DOCX, and HTML file uploads
 */

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../tmp/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.memoryStorage(); // Store in memory for processing

// File filter
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.docx', '.html', '.htm'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: fileFilter
});

/**
 * Middleware for single file upload
 */
const uploadSingleFile = (fieldName) => {
  return (req, res, next) => {
    const uploadSingle = upload.single(fieldName);

    uploadSingle(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // Multer error
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File too large',
            message: 'Maximum file size is 10MB',
            code: 'E201'
          });
        }
        return res.status(400).json({
          error: 'File upload error',
          message: err.message
        });
      } else if (err) {
        // Other errors
        return res.status(400).json({
          error: 'Invalid file',
          message: err.message,
          code: 'E202'
        });
      }

      // No error, continue
      next();
    });
  };
};

/**
 * Middleware for multiple file uploads
 */
const uploadMultipleFiles = (fields) => {
  return (req, res, next) => {
    const uploadFields = upload.fields(fields);

    uploadFields(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File too large',
            message: 'Maximum file size is 10MB per file',
            code: 'E201'
          });
        }
        return res.status(400).json({
          error: 'File upload error',
          message: err.message
        });
      } else if (err) {
        return res.status(400).json({
          error: 'Invalid file',
          message: err.message,
          code: 'E202'
        });
      }

      next();
    });
  };
};

module.exports = {
  uploadSingleFile,
  uploadMultipleFiles
};
