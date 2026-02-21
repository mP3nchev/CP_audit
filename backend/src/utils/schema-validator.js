'use strict';

const SCHEMA_VERSION = '1.1.0';

const SCHEMAS = {
  scanResult: {
    required: ['cookies', 'networkRequests', 'trackingBeforeConsent'],
    arrayFields: ['cookies', 'networkRequests'],
    booleanFields: ['trackingBeforeConsent'],
    objectFields: ['consentModeAudit']
  },
  policyAnalysis: {
    required: ['criteria', 'total_score', 'max_score', 'percentage', 'category'],
    arrayFields: ['criteria'],
    numberFields: ['total_score', 'max_score', 'percentage'],
    stringFields: ['category']
  },
  bannerViolations: {
    required: ['violations', 'passedChecks'],
    arrayFields: ['violations', 'passedChecks'],
    numberFields: ['totalChecks', 'passedCount', 'violationCount']
  }
};

function validateSchema(schemaName, data) {
  const schema = SCHEMAS[schemaName];
  if (!schema) throw Object.assign(new Error(`Unknown schema: ${schemaName}`), { code: 'SCHEMA_UNKNOWN' });

  if (data === null || typeof data !== 'object') {
    throw Object.assign(
      new Error(`Schema [${schemaName}]: expected object, got ${typeof data}`),
      { code: 'SCHEMA_TYPE_ERROR' }
    );
  }

  const errors = [];

  for (const field of (schema.required || [])) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`missing required field: "${field}"`);
    }
  }

  for (const field of (schema.arrayFields || [])) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      errors.push(`field "${field}": expected array, got ${typeof data[field]}`);
    }
  }

  for (const field of (schema.numberFields || [])) {
    if (data[field] !== undefined && typeof data[field] !== 'number') {
      errors.push(`field "${field}": expected number, got ${typeof data[field]}`);
    }
  }

  for (const field of (schema.booleanFields || [])) {
    if (data[field] !== undefined && typeof data[field] !== 'boolean') {
      errors.push(`field "${field}": expected boolean, got ${typeof data[field]}`);
    }
  }

  for (const field of (schema.objectFields || [])) {
    if (data[field] !== undefined && (typeof data[field] !== 'object' || Array.isArray(data[field]))) {
      errors.push(`field "${field}": expected object, got ${Array.isArray(data[field]) ? 'array' : typeof data[field]}`);
    }
  }

  if (errors.length > 0) {
    const err = new Error(`Schema validation failed [${schemaName} v${SCHEMA_VERSION}]: ${errors.join('; ')}`);
    err.code = 'SCHEMA_VALIDATION_FAILED';
    err.schemaName = schemaName;
    err.schemaVersion = SCHEMA_VERSION;
    err.validationErrors = errors;
    throw err;
  }
}

function safeStringify(schemaName, data) {
  validateSchema(schemaName, data);
  try {
    return JSON.stringify(data);
  } catch (err) {
    throw Object.assign(
      new Error(`JSON serialization failed for schema [${schemaName}]: ${err.message}`),
      { code: 'JSON_SERIALIZE_ERROR' }
    );
  }
}

module.exports = { validateSchema, safeStringify, SCHEMA_VERSION };
