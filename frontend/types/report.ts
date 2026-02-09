// Report Data Types - Canonical type definitions for v2 report template

export interface ReportMeta {
  scanId: string;
  scanDate: string;
  scanDateFull: string;
  scannerVersion: string;
  targetUrl: string;
  userAgent: string;
  auditType: string;
  preparedFor: string;
  preparedBy: string;
}

export interface TopFinding {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
}

export interface ExecutiveSummary {
  complianceStatus: string;
  statusDescription: string;
  topFindings: TopFinding[];
  businessImpact: string[];
  miniRoadmap: {
    immediate: string;
    twoWeeks: string;
    thirtyDays: string;
  };
}

export interface ScopeMethod {
  method: string;
  description: string;
}

export interface Scope {
  whatWeTested: string[];
  howWeTested: ScopeMethod[];
  limitations: string[];
}

export interface HighRiskFinding {
  headline: string;
  severity: 'critical' | 'high';
  confidence: string;
  confidenceReason: string;
  observation: string;
  legalContext: string;
  businessRisk: string;
  recommendation: string;
  effort: string;
  topEvidence?: Array<{
    type: string;
    domain: string;
    url: string;
    timing: string;
  }>;
  totalEvidenceCount?: number;
}

export interface MediumFinding {
  title: string;
  severity: 'medium' | 'low';
  description: string;
  businessImpact: string;
  recommendation: string;
}

export interface Cookie {
  name: string;
  category: string;
  vendor: string;
  purpose: string;
  lifespan: string;
  declared: boolean;
}

export interface ComplianceRequirement {
  requirement: string;
  status: 'pass' | 'fail' | 'warning';
  evidence: string;
  businessImpact: string;
  fix: string;
}

export interface PolicyCriterion {
  name: string;
  score: number;
  maxScore: number;
  status: 'pass' | 'fail' | 'warning';
  explanation: string;
}

export interface PolicyTier {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  percentage: number;
  earnedPoints: number;
  maxPoints: number;
  criteria: PolicyCriterion[];
}

export interface PrivacyPolicyAnalysis {
  finalScore: number;
  finalTotal: number;
  tiers: PolicyTier[];
}

export interface ConsentChecklistItem {
  requirement: string;
  status: 'pass' | 'fail';
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface RiskBreakdownItem {
  category: string;
  percentage: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}

export interface ConsentModeV2Data {
  detected: boolean;
  version: string | null;
  compliant: boolean;
  confidence: number;
  detectionMethod: string | null;
  consentStates: Record<string, string>;
  issues: string[];
  ga4Present: boolean;
}

export interface ReportData {
  meta: ReportMeta;
  executive: ExecutiveSummary;
  scope: Scope;
  finding1?: HighRiskFinding | null;
  finding2?: HighRiskFinding | null;
  mediumFindings: MediumFinding[];
  cookies: Cookie[];
  complianceMatrix: ComplianceRequirement[];
  privacyPolicyAnalysis: PrivacyPolicyAnalysis;
  consentChecklist: ConsentChecklistItem[];
  riskBreakdown: RiskBreakdownItem[];
  consentModeV2?: ConsentModeV2Data | null;
}
