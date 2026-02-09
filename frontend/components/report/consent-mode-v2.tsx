import { ReportSection } from "./report-section";
import type { ConsentModeV2Data } from "@/types/report";
import {
  Fingerprint,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

const PARAMETER_LABELS: Record<string, string> = {
  ad_storage: "Ad Storage",
  analytics_storage: "Analytics Storage",
  ad_user_data: "Ad User Data",
  ad_personalization: "Ad Personalization",
  functionality_storage: "Functionality Storage",
  personalization_storage: "Personalization Storage",
  security_storage: "Security Storage",
};

function ConsentStateIndicator({ state }: { state: string }) {
  if (state === "denied") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cp-success)]">
        <CheckCircle2 className="h-3.5 w-3.5" />
        denied
      </span>
    );
  }
  if (state === "granted") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cp-warning)]">
        <AlertTriangle className="h-3.5 w-3.5" />
        granted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cp-error)]">
      <XCircle className="h-3.5 w-3.5" />
      {state || "not_set"}
    </span>
  );
}

export function ConsentModeV2({
  consentModeV2,
}: {
  consentModeV2: ConsentModeV2Data | null | undefined;
}) {
  // Nothing to show if no data
  if (!consentModeV2) {
    return null;
  }

  const { detected, version, compliant, confidence, detectionMethod, consentStates, issues, ga4Present } = consentModeV2;

  // If not detected and no GA4 present, skip section
  if (!detected && !ga4Present) {
    return null;
  }

  return (
    <ReportSection
      id="consent-mode-v2"
      title="Google Consent Mode V2"
      subtitle={
        detected
          ? "Implementation status and default consent states"
          : "Consent Mode not detected"
      }
      icon={<Fingerprint className="h-5 w-5" />}
    >
      {/* Status banner */}
      <div
        className={`mb-6 flex items-start gap-3 rounded-xl border-2 p-4 ${
          detected && compliant
            ? "border-[var(--cp-success)] bg-[var(--cp-success-light)]"
            : "border-[var(--cp-error)] bg-[var(--cp-error-light)]"
        }`}
      >
        {detected && compliant ? (
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--cp-success)]" />
        ) : (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--cp-error)]" />
        )}
        <div>
          <p
            className={`text-sm font-semibold ${
              detected && compliant
                ? "text-[var(--cp-success)]"
                : "text-[var(--cp-error)]"
            }`}
          >
            {detected && compliant
              ? "Google Consent Mode V2 is properly configured with GDPR-compliant defaults."
              : detected
                ? "Google Consent Mode was detected but configuration issues were found."
                : "Google Analytics 4 was detected but Google Consent Mode is not implemented. This is required for GDPR compliance when using Google Analytics in the EEA."}
          </p>
        </div>
      </div>

      {/* Metrics cards - only show when detected */}
      {detected && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
              <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">
                Version
              </div>
              <div className="text-sm font-bold text-[var(--cp-neutral-100)]">
                {version ?? "Unknown"}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
              <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">
                Confidence
              </div>
              <div className="text-sm font-bold text-[var(--cp-neutral-100)]">
                {confidence}%
              </div>
            </div>
            <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
              <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">
                Status
              </div>
              <div
                className={`text-sm font-bold ${
                  compliant
                    ? "text-[var(--cp-success)]"
                    : "text-[var(--cp-error)]"
                }`}
              >
                {compliant ? "Compliant" : "Issues Found"}
              </div>
            </div>
            {detectionMethod && (
              <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
                <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">
                  Detection Method
                </div>
                <div className="text-xs font-semibold text-[var(--cp-neutral-90)] break-words">
                  {detectionMethod}
                </div>
              </div>
            )}
          </div>

          {/* Default Consent States */}
          <h3 className="mb-3 text-sm font-semibold text-[var(--cp-neutral-100)]">
            Default Consent States
          </h3>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(consentStates).map(([param, state]: [string, string]) => (
              <div
                key={param}
                className="flex items-center justify-between rounded-lg border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] px-3 py-2.5"
              >
                <span className="text-xs font-medium text-[var(--cp-neutral-80)]">
                  {PARAMETER_LABELS[param] ?? param}
                </span>
                <ConsentStateIndicator state={state} />
              </div>
            ))}
          </div>

          {/* Issues list */}
          {issues.length > 0 && (
            <div className="rounded-xl border-2 border-[var(--cp-error)] bg-[var(--cp-white)] p-4">
              <h4 className="mb-2 text-sm font-semibold text-[var(--cp-error)]">
                Issues
              </h4>
              <ul className="space-y-1">
                {issues.map((issue: string, i: number) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-[var(--cp-neutral-90)]"
                  >
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--cp-error)]" />
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </ReportSection>
  );
}
