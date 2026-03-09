#!/usr/bin/env node
/**
 * verify-refactor-output.js
 *
 * Compares two scan_results rows by audit_uid to verify that the
 * step-runner refactor (Phase B) produces identical output.
 *
 * Usage:
 *   node backend/test/verify-refactor-output.js <pre_refactor_uid> <post_refactor_uid>
 *
 * Reports per-column: MATCH, MISMATCH (with details), or NULL.
 * Acceptable differences: timestamps, timing values.
 * Unacceptable differences: violation counts, category assignments,
 *   cookie classifications, banner check results.
 */

const path = require('path');

// Bootstrap database from project root
const dbPath = path.resolve(__dirname, '..', 'src', 'database', 'db');
const { getDatabase } = require(dbPath);

const JSON_COLUMNS = [
  'cookies_json',
  'network_requests_json',
  'banner_violations_json',
  'timeline_json',
  'compliance_score_json',
  'request_categorization_json',
  'consent_simulation_json',
  'monitoring_data_json',
  'monitoring_analysis_json',
  'detected_vendors_json',
  'vendor_summary_json',
  'network_storage_correlations_json',
  'banner_detection_json'
];

const SCALAR_COLUMNS = [
  'tracking_before_consent',
  'consent_mode_v2_status',
  'scan_duration_seconds'
];

// Keys that are expected to differ between runs (timing-related)
const TIMING_KEYS = new Set([
  'timestamp', 'detectedAt', 'detectedAtAbsolute', 'timeMs',
  'startTime', 'endTime', 'duration', 'scanDuration',
  'created_at', 'loadEventEnd', 'navigationStart',
  'pageLoadTime', 'responseTime', 'requestTime'
]);

function loadRow(db, auditUid) {
  const audit = db.prepare('SELECT id FROM audits WHERE uid = ?').get(auditUid);
  if (!audit) {
    console.error(`ERROR: No audit found with uid="${auditUid}"`);
    process.exit(1);
  }

  const row = db.prepare('SELECT * FROM scan_results WHERE audit_id = ?').get(audit.id);
  if (!row) {
    console.error(`ERROR: No scan_results found for audit_id=${audit.id} (uid="${auditUid}")`);
    process.exit(1);
  }

  return row;
}

function deepCompare(a, b, path = '', diffs = []) {
  if (a === b) return diffs;

  if (a === null || a === undefined || b === null || b === undefined) {
    diffs.push({ path, pre: a, post: b, type: 'null_mismatch' });
    return diffs;
  }

  if (typeof a !== typeof b) {
    diffs.push({ path, pre: typeof a, post: typeof b, type: 'type_mismatch' });
    return diffs;
  }

  // Skip timing-related keys
  const lastKey = path.split('.').pop();
  if (TIMING_KEYS.has(lastKey)) {
    return diffs; // acceptable difference
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push({ path, pre: `length=${a.length}`, post: `length=${b.length}`, type: 'array_length' });
    }
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      deepCompare(a[i], b[i], `${path}[${i}]`, diffs);
    }
    return diffs;
  }

  if (typeof a === 'object') {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
      if (TIMING_KEYS.has(key)) continue;
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in a)) {
        diffs.push({ path: childPath, pre: '(missing)', post: summarize(b[key]), type: 'key_added' });
      } else if (!(key in b)) {
        diffs.push({ path: childPath, pre: summarize(a[key]), post: '(missing)', type: 'key_removed' });
      } else {
        deepCompare(a[key], b[key], childPath, diffs);
      }
    }
    return diffs;
  }

  // Primitive value mismatch
  diffs.push({ path, pre: summarize(a), post: summarize(b), type: 'value_mismatch' });
  return diffs;
}

function summarize(val) {
  if (val === null || val === undefined) return String(val);
  if (typeof val === 'string' && val.length > 60) return val.substring(0, 60) + '...';
  return String(val);
}

// Critical fields — mismatches here indicate a regression
const CRITICAL_PATTERNS = [
  'violationCount', 'violations', 'hasCriticalViolations',
  'category', 'categoryA', 'categoryB', 'categoryC',
  'classification', 'isTracking', 'trackingBeforeConsent',
  'overallScore', 'grade', 'bannerDetected',
  'compliant', 'detected', 'version'
];

function isCriticalDiff(diff) {
  return CRITICAL_PATTERNS.some(p => diff.path.includes(p));
}

function main() {
  const [,, preUid, postUid] = process.argv;

  if (!preUid || !postUid) {
    console.error('Usage: node verify-refactor-output.js <pre_refactor_uid> <post_refactor_uid>');
    process.exit(1);
  }

  const db = getDatabase();
  const preRow = loadRow(db, preUid);
  const postRow = loadRow(db, postUid);

  console.log('='.repeat(80));
  console.log('REFACTOR OUTPUT VERIFICATION');
  console.log(`Pre-refactor:  uid=${preUid}`);
  console.log(`Post-refactor: uid=${postUid}`);
  console.log('='.repeat(80));

  let totalMatch = 0;
  let totalMismatch = 0;
  let totalNull = 0;
  let criticalMismatches = 0;

  // Check scalar columns
  for (const col of SCALAR_COLUMNS) {
    const preVal = preRow[col];
    const postVal = postRow[col];

    if (preVal === postVal) {
      console.log(`\n[MATCH]    ${col}: ${summarize(preVal)}`);
      totalMatch++;
    } else if (col === 'scan_duration_seconds') {
      console.log(`\n[TIMING]   ${col}: pre=${preVal}, post=${postVal} (acceptable)`);
      totalMatch++;
    } else {
      console.log(`\n[MISMATCH] ${col}: pre=${summarize(preVal)}, post=${summarize(postVal)}`);
      totalMismatch++;
    }
  }

  // Check JSON columns
  for (const col of JSON_COLUMNS) {
    const preVal = preRow[col];
    const postVal = postRow[col];

    if (preVal === null && postVal === null) {
      console.log(`\n[NULL]     ${col}: both null`);
      totalNull++;
      continue;
    }

    if ((preVal === null) !== (postVal === null)) {
      console.log(`\n[MISMATCH] ${col}: pre=${preVal === null ? 'NULL' : 'present'}, post=${postVal === null ? 'NULL' : 'present'}`);
      totalMismatch++;
      continue;
    }

    let preObj, postObj;
    try { preObj = JSON.parse(preVal); } catch { preObj = preVal; }
    try { postObj = JSON.parse(postVal); } catch { postObj = postVal; }

    const diffs = deepCompare(preObj, postObj);

    if (diffs.length === 0) {
      console.log(`\n[MATCH]    ${col}`);
      totalMatch++;
    } else {
      const critical = diffs.filter(isCriticalDiff);
      const nonCritical = diffs.filter(d => !isCriticalDiff(d));

      if (critical.length > 0) {
        console.log(`\n[CRITICAL] ${col}: ${critical.length} critical + ${nonCritical.length} minor differences`);
        criticalMismatches += critical.length;
        for (const d of critical.slice(0, 10)) {
          console.log(`           ! ${d.path}: pre=${d.pre}, post=${d.post} (${d.type})`);
        }
      } else {
        console.log(`\n[MINOR]    ${col}: ${nonCritical.length} non-critical differences (timing/ordering)`);
      }

      if (nonCritical.length > 0 && nonCritical.length <= 5) {
        for (const d of nonCritical) {
          console.log(`           ~ ${d.path}: pre=${d.pre}, post=${d.post} (${d.type})`);
        }
      }

      totalMismatch++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log(`  Match:    ${totalMatch}`);
  console.log(`  Mismatch: ${totalMismatch}`);
  console.log(`  Null:     ${totalNull}`);
  console.log(`  Critical: ${criticalMismatches}`);
  console.log('='.repeat(80));

  if (criticalMismatches > 0) {
    console.log('\nRESULT: FAIL — Critical mismatches detected. The cutover has a bug.');
    process.exit(1);
  } else if (totalMismatch === 0) {
    console.log('\nRESULT: PASS — All columns match (timing differences excluded).');
    process.exit(0);
  } else {
    console.log('\nRESULT: WARN — Minor differences found. Review manually.');
    process.exit(0);
  }
}

main();
