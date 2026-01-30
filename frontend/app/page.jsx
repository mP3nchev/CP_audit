'use client';

import { useState, useEffect } from 'react';
import AuditForm from './components/AuditForm';
import ResultsDisplay from './components/ResultsDisplay';

export default function Home() {
  const [completedAudit, setCompletedAudit] = useState(null);

  // Check URL params on mount (for resume redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auditId = params.get('audit');
    const status = params.get('status');

    if (auditId && status === 'completed') {
      console.log('📋 Detected completed audit from URL params:', auditId);
      setCompletedAudit({ auditId, status: 'completed' });

      // Clean URL (remove params)
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleAuditComplete = (result) => {
    setCompletedAudit(result);
  };

  const handleNewAudit = () => {
    setCompletedAudit(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Hero Section */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-gray-900">
          GDPR Compliance Auditor
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Professional GDPR Privacy & Cookie Compliance auditing tool. Scan websites for
          cookie/tracking violations and analyze Privacy & Cookie Policies.
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 text-center">
          <div className="text-3xl mb-2">🍪</div>
          <h3 className="font-semibold text-gray-900 mb-1">Cookie Scanner</h3>
          <p className="text-sm text-gray-600">Detect all cookies and tracking</p>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 text-center">
          <div className="text-3xl mb-2">📄</div>
          <h3 className="font-semibold text-gray-900 mb-1">Policy Analysis</h3>
          <p className="text-sm text-gray-600">AI-powered 37 GDPR criteria</p>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 text-center">
          <div className="text-3xl mb-2">⚖️</div>
          <h3 className="font-semibold text-gray-900 mb-1">Risk Assessment</h3>
          <p className="text-sm text-gray-600">Calculate potential fines</p>
        </div>
      </div>

      {/* Main Content */}
      {completedAudit ? (
        <div className="space-y-4">
          <ResultsDisplay
            auditId={completedAudit.auditId}
            status={completedAudit.status}
            websiteUrl={completedAudit.websiteUrl}
            instructions={completedAudit.instructions}
          />

          <button
            onClick={handleNewAudit}
            className="w-full bg-gray-100 text-gray-900 py-3 px-6 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            Start New Audit
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            Start Your Audit
          </h2>
          <AuditForm onAuditComplete={handleAuditComplete} />
        </div>
      )}

      {/* Additional Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">
          What You'll Get:
        </h3>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-blue-800">
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>Complete cookie and tracking analysis</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>noyb compliance checklist results</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>Privacy Policy GDPR scoring (37 criteria)</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>Risk assessment with potential fines</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>Cookie comparison (declared vs. detected)</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>Actionable recommendations</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>Google Consent Mode V2 validation</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2 mt-0.5">✓</span>
            <span>Professional HTML report with charts</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
