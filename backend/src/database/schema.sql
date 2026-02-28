-- Audits table
CREATE TABLE IF NOT EXISTS audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_uid TEXT UNIQUE NOT NULL,
    website_url TEXT NOT NULL,
    client_name TEXT,
    industry TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    overall_score INTEGER,
    score_grade TEXT,
    progress_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Scan results table
CREATE TABLE IF NOT EXISTS scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL,
    cookies_json TEXT NOT NULL,
    network_requests_json TEXT NOT NULL,
    tracking_before_consent BOOLEAN DEFAULT 0,
    screenshot_full_url TEXT,
    screenshot_banner_url TEXT,
    consent_mode_v2_status TEXT,
    banner_violations_json TEXT,
    timeline_json TEXT,
    compliance_score_json TEXT,
    request_categorization_json TEXT,
    consent_simulation_json TEXT,
    monitoring_data_json TEXT,
    monitoring_analysis_json TEXT,
    detected_vendors_json TEXT,
    vendor_summary_json TEXT,
    scan_duration_seconds INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
);

-- Policy analysis table
CREATE TABLE IF NOT EXISTS policy_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL,
    policy_type TEXT NOT NULL,
    criteria_scores_json TEXT NOT NULL,
    total_score REAL,
    percentage REAL,
    category TEXT,
    top_recommendations_json TEXT,
    policy_text TEXT,
    analysis_duration_seconds INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
);

-- Cookie policy comparison table
CREATE TABLE IF NOT EXISTS cookie_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL,
    declared_cookies_json TEXT,
    undeclared_cookies_json TEXT,
    mismatched_retention_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
);

-- Risk assessment table
CREATE TABLE IF NOT EXISTS risk_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL,
    violations_json TEXT NOT NULL,
    total_risk_min INTEGER,
    total_risk_max INTEGER,
    risk_level TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
);

-- API cost tracking table (REMOVED per product audit recommendation 2.5)
-- Reason: API costs negligible ($0.40-0.75/audit), tracked via Anthropic dashboard
-- CREATE TABLE IF NOT EXISTS api_costs (
--     id INTEGER PRIMARY KEY AUTOINCREMENT,
--     audit_id INTEGER,
--     operation TEXT NOT NULL,
--     input_tokens INTEGER,
--     output_tokens INTEGER,
--     cached_tokens INTEGER DEFAULT 0,
--     cost_usd REAL,
--     model TEXT,
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
-- );

-- Budget tracking table (lightweight persistence for budget control)
-- Prevents budget bypass on server restarts (critical for production auto-scaling)
CREATE TABLE IF NOT EXISTS budget_tracking (
    date TEXT PRIMARY KEY,              -- Format: 'YYYY-MM-DD'
    spent_usd REAL NOT NULL DEFAULT 0,  -- Total spent on this date
    reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GDPR Precedents table
CREATE TABLE IF NOT EXISTS gdpr_precedents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dpa TEXT NOT NULL,
    case_number TEXT,
    jurisdiction TEXT NOT NULL,
    decision_date TEXT,
    relevant_articles TEXT,
    fine_eur INTEGER,
    sector TEXT,
    summary TEXT
);

-- Auto-update updated_at on business column changes (prevents trigger recursion)
CREATE TRIGGER IF NOT EXISTS trg_audits_updated_at
AFTER UPDATE OF status, error_message, overall_score, score_grade, progress_json,
             completed_at ON audits
FOR EACH ROW
BEGIN
  UPDATE audits SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
CREATE INDEX IF NOT EXISTS idx_audits_created ON audits(created_at);
-- CREATE INDEX IF NOT EXISTS idx_api_costs_audit ON api_costs(audit_id); -- Removed with api_costs table
CREATE INDEX IF NOT EXISTS idx_precedents_articles ON gdpr_precedents(relevant_articles);
CREATE INDEX IF NOT EXISTS idx_precedents_jurisdiction ON gdpr_precedents(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_precedents_fine ON gdpr_precedents(fine_eur);
