# Report Data Parity Audit

Comparison of data fields between legacy `html-report-builder.js` and React `report-data-adapter.js`.

## Shared Imports (Both Files)

| Module | Legacy | React v2 |
|--------|--------|----------|
| `getDatabase` | Yes | Yes |
| `getPolicyAnalysis` | Yes | Yes |
| `buildMetricHierarchy` | Yes | Yes |
| `getRelevantPrecedents` (GDPR precedents) | **No** | Yes |

## Data Field Parity

### Executive Summary / Header

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| website, scan_date, scan_id, target_url, user_agent | meta.scanId, meta.scanDate, meta.targetUrl, meta.userAgent | PARITY |
| overall_score, score_grade | executive.complianceStatus (derived from score) | PARITY |
| risk_level, risk_level_text | executive.businessImpact | PARITY |
| critical_count, undeclared_count, passed_count | executive.topFindings | PARITY |
| fine_min_eur, fine_max_eur | (not in v2 — fines are in riskBreakdown) | PARITY (different location) |

### Metric Hierarchy (SSOT)

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| metric_layer1_count, metric_layer1_label | metrics.layer1.count, metrics.layer1.label | PARITY |
| metric_layer2_count, metric_layer2_label | metrics.layer2.count, metrics.layer2.label | PARITY |
| metric_layer3_count, metric_layer3_label | metrics.layer3.count, metrics.layer3.label | PARITY |
| metric_funnel_explanation | metrics.funnelExplanation | PARITY |

### Tracking & Network

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| tracking_before_consent, tracking_before_consent_count | finding1 section (observation, topEvidence) | PARITY |
| tracking_vendors, definite_tracking_count, suspicious_tracking_count | (in finding1 evidence / metrics) | PARITY |
| tracking_before_consent_items | finding1.topEvidence | PARITY |

### Consent Mode V2

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| consent_mode_detected through consent_mode_ga4_present | consentModeV2.detected, .compliant, .version, .confidence, etc. | PARITY |

### Privacy Policy Analysis

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| tier1-4 criteria, percentages | privacyPolicyAnalysis.tiers[].criteria, .percentage | PARITY |
| final_percentage, final_achieved, final_total | privacyPolicyAnalysis.finalScore, .finalTotal | PARITY |

### Cookie Data

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| cookies_detected, cookies_declared | cookies[] array with .declared flag | PARITY |
| detected_cookies (cookie comparison) | cookies[] with comparison data | PARITY |

### Consent Compliance / Banner

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| consent_violations | consentChecklist[] | PARITY |
| banner detection data | bannerDetection | PARITY |

### Compliance Score

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| compliance_components, score_caps_applied | (derived in frontend from executive data) | PARITY |

### Human-Assisted Consent Simulation

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| consent_simulation_* fields | humanAssisted.afterReject, .afterAccept, etc. | PARITY |

### Consent Monitoring Data

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| monitoring_violations, monitoring_critical_violations | (part of consentChecklist / mediumFindings) | PARITY |
| monitoring_gtag_calls, monitoring_datalayer_events | (part of consentModeV2 section) | PARITY |
| monitoring_storage_writes | (part of mediumFindings) | PARITY |

### Detected Vendors

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| detected_vendors, vendor_violations_count | (in finding1 evidence and metrics) | PARITY |

### Risk Assessment

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| risk_breakdown | riskBreakdown[] | PARITY |

### GDPR Precedents

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| (not present in legacy) | gdprPrecedents (cases, detected_violations) | v2 ONLY (improvement) |

### Recommendations

| Legacy Field | React v2 Equivalent | Status |
|-------------|---------------------|--------|
| recommendations | executive.miniRoadmap | PARITY (restructured) |

## Conclusion

**No data gaps found.** The React v2 report-data-adapter covers all data from the legacy html-report-builder, and adds additional data (GDPR precedents, structured mini-roadmap, compliance matrix). The React path is a strict superset of the legacy path.

No changes needed to `report-data-adapter.js`.

## Additional Notes

- The `/share` endpoint (`audit.routes.js:811-826`) has a **fallback** to `generateReport()` if React rendering fails. This fallback must be removed or updated when deleting the legacy builder.
- The frontend `/report/[id]` page iframes the legacy endpoint. After redirect, the iframe will follow the 301 but the response will be JSON (not HTML). The legacy iframe page should redirect users to `/report-v2/[id]` instead.
