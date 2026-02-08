import React from "react";
import { ReportSection } from "./report-section";
import { CheckCircle2, Shield } from "lucide-react";

export function ConsentModeV2({ consentMode }) {
  if (!consentMode || !consentMode.detected) {
    return null;
  }

  const isCompliant = consentMode.version === 'v2' && consentMode.compliant;

  return (
    <ReportSection
      id="consent-mode-v2"
      title="Google Consent Mode V2"
      subtitle="GDPR-compliant consent signal configuration"
      icon={<Shield className="h-5 w-5" />}
    >
      {/* Compliance Status Badge */}
      <div className={`rounded-xl border overflow-hidden ${
        isCompliant
          ? 'border-[var(--cp-success)]/20 bg-[var(--cp-success-light)]'
          : 'border-[var(--cp-error)]/20 bg-[var(--cp-error-light)]'
      }`}>
        <div className="px-6 py-4">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className={`h-6 w-6 ${
              isCompliant ? 'text-[var(--cp-success)]' : 'text-[var(--cp-error)]'
            }`} />
            <div>
              <h3 className={`text-lg font-semibold ${
                isCompliant ? 'text-[var(--cp-success)]' : 'text-[var(--cp-error)]'
              }`}>
                {isCompliant
                  ? 'Google Consent Mode V2 - Compliant'
                  : `Google Consent Mode ${consentMode.version === 'v2' ? 'V2' : 'V1 or Incomplete'}`
                }
              </h3>
              <p className="text-sm text-[var(--cp-neutral-80)] mt-1">
                {isCompliant
                  ? 'Google Consent Mode V2 is properly configured with GDPR-compliant defaults'
                  : consentMode.version === 'v2'
                    ? 'V2 detected but defaults need adjustment'
                    : 'Upgrade to Consent Mode V2 is recommended'
                }
              </p>
            </div>
          </div>

          {/* Consent Parameters */}
          {consentMode.parameters && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(consentMode.parameters).map(([param, value]) => (
                <div key={param} className="rounded-lg bg-[var(--cp-white)] border border-[var(--cp-neutral-40)] px-3 py-2">
                  <div className="text-xs font-medium text-[var(--cp-neutral-80)] uppercase tracking-wider">
                    {param.replace(/_/g, ' ')}
                  </div>
                  <div className={`text-sm font-semibold mt-1 ${
                    value === 'denied' ? 'text-[var(--cp-success)]' :
                    value === 'granted' ? 'text-[var(--cp-error)]' :
                    'text-[var(--cp-warning)]'
                  }`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Issues (if any) */}
          {consentMode.issues && consentMode.issues.length > 0 && (
            <div className="mt-4 rounded-lg bg-[var(--cp-warning-light)] border border-[var(--cp-warning)]/20 px-4 py-3">
              <h4 className="text-sm font-semibold text-[var(--cp-warning)] mb-2">
                Configuration Issues:
              </h4>
              <ul className="text-sm text-[var(--cp-neutral-100)] space-y-1">
                {consentMode.issues.map((issue, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-[var(--cp-warning)] mt-0.5">⚠</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {consentMode.recommendations && consentMode.recommendations.length > 0 && (
            <div className="mt-4 rounded-lg bg-[var(--cp-blue-15)] border border-[var(--cp-blue-100)]/20 px-4 py-3">
              <h4 className="text-sm font-semibold text-[var(--cp-blue-150)] mb-2">
                Recommendations:
              </h4>
              <ul className="text-sm text-[var(--cp-neutral-100)] space-y-1.5">
                {consentMode.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-[var(--cp-blue-100)] mt-0.5">→</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </ReportSection>
  );
}
