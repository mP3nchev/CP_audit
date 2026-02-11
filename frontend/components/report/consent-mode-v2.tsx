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

/**
 * Official descriptions per Google Consent Mode v2 specification.
 * ad_user_data and ad_personalization are the NEW required params in V2.
 */
const PARAMETER_DESCRIPTIONS: Record<string, { description: string; isV2New?: boolean }> = {
  ad_storage: {
    description: "Manages consent for cookies and storage used for advertising (e.g. Google Ads, remarketing).",
  },
  analytics_storage: {
    description: "Manages consent for cookies and storage used for analytics (e.g. GA4 session duration, pageviews).",
  },
  ad_user_data: {
    description: "Controls sending of user data to Google for online advertising purposes (required by V2).",
    isV2New: true,
  },
  ad_personalization: {
    description: "Sets consent for personalized advertising and remarketing (required by V2).",
    isV2New: true,
  },
  functionality_storage: {
    description: "Enables storage supporting site functionality (e.g. language preferences, login state).",
  },
  personalization_storage: {
    description: "Enables storage related to personalisation (e.g. video recommendations).",
  },
  security_storage: {
    description: "Enables storage related to security functions (e.g. authentication, fraud prevention).",
  },
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

      {/* Metrics cards — only when detected */}
      {detected && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
            <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">Version</div>
            <div className="text-sm font-bold text-[var(--cp-neutral-100)]">{version ?? "Unknown"}</div>
          </div>
          <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
            <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">Confidence</div>
            <div className="text-sm font-bold text-[var(--cp-neutral-100)]">{confidence}%</div>
          </div>
          <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
            <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">Status</div>
            <div className={`text-sm font-bold ${compliant ? "text-[var(--cp-success)]" : "text-[var(--cp-error)]"}`}>
              {compliant ? "Compliant" : "Issues Found"}
            </div>
          </div>
          {detectionMethod && (
            <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-3 text-center">
              <div className="text-xs font-medium text-[var(--cp-neutral-60)] mb-1">Detection Method</div>
              <div className="text-xs font-semibold text-[var(--cp-neutral-90)] break-words">{detectionMethod}</div>
            </div>
          )}
        </div>
      )}

      {/* Default Consent States — always shown when GA4 is present (detected OR not).
          When not detected, all 4 params show as 'not_set', making the gap explicit.
          Per Google Consent Mode v2 spec: all 4 MUST default to 'denied'. */}
      {(detected || ga4Present) && Object.keys(consentStates).length > 0 && (
        <>
          <h3 className="mb-1 text-sm font-semibold text-[var(--cp-neutral-100)]">
            Default Consent States
          </h3>
          <p className="mb-3 text-xs text-[var(--cp-neutral-60)]">
            All 4 core parameters must default to{" "}
            <strong className="text-[var(--cp-success)]">denied</strong> before the
            user gives consent (GDPR Art. 7 + Google Consent Mode v2 requirements).{" "}
            <strong className="text-[var(--cp-error)]">not_set</strong> or{" "}
            <strong className="text-[var(--cp-warning)]">granted</strong> states
            indicate a compliance gap.
          </p>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(consentStates).map(([param, state]: [string, string]) => {
              const meta = PARAMETER_DESCRIPTIONS[param];
              return (
                <div
                  key={param}
                  className="rounded-lg border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-[var(--cp-neutral-90)]">
                      {PARAMETER_LABELS[param] ?? param}
                      {meta?.isV2New && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200 align-middle">
                          New V2
                        </span>
                      )}
                    </span>
                    <ConsentStateIndicator state={state} />
                  </div>
                  {meta && (
                    <p className="text-[11px] text-[var(--cp-neutral-60)] leading-snug">
                      {meta.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Issues list — only when detected and issues exist */}
      {detected && issues.length > 0 && (
        <div className="rounded-xl border-2 border-[var(--cp-error)] bg-[var(--cp-white)] p-4">
          <h4 className="mb-2 text-sm font-semibold text-[var(--cp-error)]">Issues</h4>
          <ul className="space-y-1">
            {issues.map((issue: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[var(--cp-neutral-90)]">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--cp-error)]" />
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ReportSection>
  );
}
