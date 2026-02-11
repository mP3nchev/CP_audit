import { ReportSection } from "./report-section";
import { BookOpen, Scale, MapPin, Calendar, Euro } from "lucide-react";
import type { GdprPrecedentsData } from "@/types/report";

const VIOLATION_LABELS: Record<string, string> = {
  tracking_without_consent: "Tracking Without Consent",
  analytics_before_consent: "Analytics Before Consent",
  invalid_reject_mechanism: "Invalid Reject Mechanism",
  pre_ticked_boxes: "Pre-ticked Boxes",
  no_reject_button: "No Reject Button",
  consent_mode_missing: "Consent Mode Missing",
  tracking_cookies: "Tracking Cookies",
  security_breach: "Security Breach",
  no_privacy_policy: "No Privacy Policy",
  unlawful_processing: "Unlawful Processing",
  data_retention: "Data Retention",
  missing_dpo: "Missing DPO",
};

export function GdprPrecedents({
  gdprPrecedents,
}: {
  gdprPrecedents?: GdprPrecedentsData | null;
}) {
  const hasCases =
    gdprPrecedents &&
    gdprPrecedents.cases &&
    gdprPrecedents.cases.length > 0;

  const detected_violations = gdprPrecedents?.detected_violations || [];
  const cases_found = gdprPrecedents?.cases_found || 0;
  const cases = gdprPrecedents?.cases || [];

  return (
    <ReportSection
      id="gdpr-precedents"
      title="GDPR Enforcement Precedents"
      subtitle={
        hasCases
          ? `${cases_found} similar case${cases_found !== 1 ? "s" : ""} from DPA decisions database (2023\u20132025)`
          : "DPA decisions database (2023\u20132025)"
      }
      icon={<BookOpen className="h-5 w-5" />}
    >
      {!hasCases && (
        <p className="text-sm text-[var(--cp-neutral-70)]">
          No matching enforcement precedents were found for the detected
          violations in the current database of 2,300+ DPA decisions.
        </p>
      )}

      {hasCases && (
        <>
      {/* Matched violations summary */}
      <div className="mb-5">
        <p className="text-xs font-semibold text-[var(--cp-neutral-80)] uppercase tracking-wider mb-2">
          Matched Violation Types
        </p>
        <div className="flex flex-wrap gap-2">
          {detected_violations.map((v) => (
            <span
              key={v}
              className="inline-flex items-center rounded-full bg-[var(--cp-blue-15)] px-3 py-1 text-xs font-medium text-[var(--cp-blue-100)]"
            >
              {VIOLATION_LABELS[v] || v}
            </span>
          ))}
        </div>
      </div>

      {/* Cases table — scrollable in web, full in PDF */}
      <div
        className="gdpr-precedents-scroll overflow-y-auto"
        style={{ maxHeight: "500px" }}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `@media print { .gdpr-precedents-scroll { max-height: none !important; overflow: visible !important; } }`,
          }}
        />
        <div className="space-y-3">
          {cases.map((c, idx) => (
            <div
              key={`${c.case_number}-${idx}`}
              className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] overflow-hidden print-avoid-break"
            >
              {/* Case header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cp-neutral-40)] bg-[var(--cp-neutral-20)] px-5 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Scale className="h-3.5 w-3.5 shrink-0 text-[var(--cp-blue-100)]" />
                  <span className="text-sm font-semibold text-[var(--cp-neutral-100)] truncate">
                    {c.dpa}
                  </span>
                  <span className="text-xs text-[var(--cp-neutral-70)]">
                    {c.case_number}
                  </span>
                </div>
                {c.fine_eur > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 border border-red-200">
                    <Euro className="h-3 w-3" />
                    {c.fine_formatted}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-[var(--cp-neutral-20)] px-2.5 py-0.5 text-xs text-[var(--cp-neutral-70)] border border-[var(--cp-neutral-40)]">
                    No fine
                  </span>
                )}
              </div>

              {/* Case body */}
              <div className="px-5 py-3 space-y-2">
                {/* Meta row */}
                <div className="flex flex-wrap gap-4 text-xs text-[var(--cp-neutral-70)]">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {c.jurisdiction}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {c.date}
                  </span>
                  {c.articles && (
                    <span>
                      GDPR Art. {c.articles}
                    </span>
                  )}
                </div>

                {/* Summary */}
                <p className="text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                  {c.summary.length > 300
                    ? c.summary.slice(0, 300) + "..."
                    : c.summary}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      </>
      )}
    </ReportSection>
  );
}
