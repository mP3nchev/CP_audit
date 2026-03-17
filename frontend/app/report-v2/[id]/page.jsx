'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import LoadingSpinner from '../../components/LoadingSpinner';

// Report components
import { SidebarNav } from '@/components/report/sidebar-nav';
import { CoverPage } from '@/components/report/cover-page';
import { ExecutiveSummary } from '@/components/report/executive-summary';
import { ScopeMethodology } from '@/components/report/scope-methodology';
import { HighRiskFinding } from '@/components/report/high-risk-finding';
import { MediumFindings } from '@/components/report/medium-findings';
import { PrivacyPolicyAnalysis } from '@/components/report/privacy-policy-analysis';
import { CookieInventory } from '@/components/report/cookie-inventory';
import { ComplianceMatrix } from '@/components/report/compliance-matrix';
import { ConsentModeV2 } from '@/components/report/consent-mode-v2';
import { GdprPrecedents } from '@/components/report/gdpr-precedents';
import { Roadmap } from '@/components/report/roadmap';
import { NextSteps } from '@/components/report/next-steps';

export default function ReportV2Page() {
  const params = useParams();
  const auditId = params.id;
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchReportData = async () => {
      try {
        // Check if audit is completed
        const statusResponse = await fetch(`/api/proxy?path=/api/audit/${auditId}/status`);
        const statusData = await statusResponse.json();

        if (!statusResponse.ok) {
          setError('Report not found');
          setLoading(false);
          return;
        }

        if (statusData.status !== 'completed') {
          setError('Report is not ready yet');
          setLoading(false);
          return;
        }

        // Fetch v2 report data
        const reportResponse = await fetch(`/api/proxy?path=/api/audit/${auditId}/report-v2`);

        if (!reportResponse.ok) {
          throw new Error('Failed to load report data');
        }

        const data = await reportResponse.json();
        setReportData(data);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load report:', err);
        setError('Failed to load report');
        setLoading(false);
      }
    };

    fetchReportData();
  }, [auditId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading premium report..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md text-center">
          <div className="text-4xl mb-3">❌</div>
          <h2 className="text-xl font-semibold text-red-900 mb-2">Error</h2>
          <p className="text-red-800">{error}</p>
          <a
            href="/"
            className="inline-block mt-4 text-blue-600 hover:text-blue-800 font-medium"
          >
            Go to Home
          </a>
        </div>
      </div>
    );
  }

  if (!reportData) {
    return null;
  }

  const { finding1, finding2 } = reportData;

  return (
    <div className="min-h-screen bg-[var(--cp-blue-5)]" data-report-ready="true">
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6 print-full-width">
        <div className="flex gap-6">
          {/* Sticky sidebar navigation */}
          <SidebarNav />

          {/* Main content */}
          <main className="flex-1 min-w-0 flex flex-col gap-6">
            <CoverPage meta={reportData.meta} />
            <ExecutiveSummary executive={reportData.executive} />
            <ScopeMethodology scope={reportData.scope} />

            {/* High-Risk Finding 1: Tracking Before Consent */}
            {finding1 && (
              <HighRiskFinding
                id="finding-1"
                number={1}
                headline={finding1.headline}
                severity={finding1.severity}
                confidence={finding1.confidence}
                confidenceReason={finding1.confidenceReason}
                observation={finding1.observation}
                legalContext={finding1.legalContext}
                businessRisk={finding1.businessRisk}
                recommendation={finding1.recommendation}
                effort={finding1.effort}
                evidence={finding1.topEvidence || []}
                totalEvidenceCount={finding1.totalEvidenceCount}
              />
            )}

            {/* High-Risk Finding 2: Reject Button */}
            {finding2 && (
              <HighRiskFinding
                id="finding-2"
                number={2}
                headline={finding2.headline}
                severity={finding2.severity}
                confidence={finding2.confidence}
                confidenceReason={finding2.confidenceReason}
                observation={finding2.observation}
                legalContext={finding2.legalContext}
                businessRisk={finding2.businessRisk}
                recommendation={finding2.recommendation}
                effort={finding2.effort}
              />
            )}

            <MediumFindings mediumFindings={reportData.mediumFindings} />
            <ConsentModeV2 consentModeV2={reportData.consentModeV2} />
            <PrivacyPolicyAnalysis privacyPolicyAnalysis={reportData.privacyPolicyAnalysis} />
            <CookieInventory cookies={reportData.cookies} />
            <ComplianceMatrix complianceMatrix={reportData.complianceMatrix} />
            <GdprPrecedents gdprPrecedents={reportData.gdprPrecedents} />
            <Roadmap roadmap={reportData.roadmap} />
            <NextSteps
              meta={reportData.meta}
              executive={reportData.executive}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
