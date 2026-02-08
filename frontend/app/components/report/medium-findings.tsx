import { reportData } from "@/lib/report-data";
import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import { ListChecks, TrendingDown, Wrench } from "lucide-react";

export function MediumFindings() {
  const { mediumFindings } = reportData;

  return (
    <ReportSection
      id="medium-findings"
      title="Additional Findings"
      subtitle="Medium and lower severity items grouped for efficiency"
      icon={<ListChecks className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {mediumFindings.map((finding) => (
          <div
            key={finding.title}
            className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] overflow-hidden print-avoid-break"
          >
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cp-neutral-40)] bg-[var(--cp-neutral-20)] px-5 py-3">
              <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
                {finding.title}
              </h3>
              <SeverityBadge severity={finding.severity} />
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-[var(--cp-neutral-90)] leading-relaxed">
                {finding.description}
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Business Impact */}
                <div className="rounded-lg border border-[var(--cp-neutral-40)] border-l-4 border-l-[var(--cp-warning)] bg-[var(--cp-warning-light)] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingDown className="h-3.5 w-3.5 text-[var(--cp-warning)]" />
                    <span className="text-xs font-semibold text-[var(--cp-neutral-100)]">
                      Business Impact
                    </span>
                  </div>
                  <p className="text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                    {finding.businessImpact}
                  </p>
                </div>

                {/* Recommendation */}
                <div className="rounded-lg border border-[var(--cp-neutral-40)] border-l-4 border-l-[var(--cp-success)] bg-[var(--cp-success-light)] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Wrench className="h-3.5 w-3.5 text-[var(--cp-success)]" />
                    <span className="text-xs font-semibold text-[var(--cp-neutral-100)]">
                      Recommended Fix
                    </span>
                  </div>
                  <p className="text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                    {finding.recommendation}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ReportSection>
  );
}
