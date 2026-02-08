import { reportData } from "@/lib/report-data";
import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import { Scale, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export function ComplianceMatrix() {
  const { complianceMatrix } = reportData;

  const passed = complianceMatrix.filter((r) => r.status === "pass").length;
  const failed = complianceMatrix.filter((r) => r.status === "fail").length;
  const warnings = complianceMatrix.filter((r) => r.status === "warning").length;

  return (
    <ReportSection
      id="compliance-matrix"
      title="GDPR & ePrivacy Compliance Mapping"
      subtitle="Legal credibility matrix — requirement by requirement"
      icon={<Scale className="h-5 w-5" />}
    >
      {/* Quick stats */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2 rounded-full bg-[var(--cp-error-light)] px-3 py-1.5">
          <XCircle className="h-3.5 w-3.5 text-[var(--cp-error)]" />
          <span className="text-xs font-semibold text-[var(--cp-error)]">
            {failed} Failed
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-[var(--cp-warning-light)] px-3 py-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-[var(--cp-warning)]" />
          <span className="text-xs font-semibold text-[var(--cp-warning)]">
            {warnings} Warning
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-[var(--cp-success-light)] px-3 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--cp-success)]" />
          <span className="text-xs font-semibold text-[var(--cp-success)]">
            {passed} Passed
          </span>
        </div>
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto print:overflow-visible rounded-xl border border-[var(--cp-neutral-40)]">
        <table className="w-full text-left text-sm print:table-fixed">
          <thead>
            <tr className="bg-[var(--cp-neutral-20)] text-xs font-semibold uppercase tracking-wider text-[var(--cp-neutral-80)]">
              <th className="px-4 py-3">Requirement</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3">Evidence</th>
              <th className="px-4 py-3">Business Impact</th>
              <th className="px-4 py-3">Recommended Fix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--cp-neutral-40)]">
            {complianceMatrix.map((row) => (
              <tr
                key={row.requirement}
                className="hover:bg-[var(--cp-blue-5)] transition-colors"
              >
                <td className="px-4 py-3 text-xs font-medium text-[var(--cp-neutral-100)] max-w-[200px]">
                  {row.requirement}
                </td>
                <td className="px-4 py-3 text-center">
                  <SeverityBadge severity={row.status} />
                </td>
                <td className="px-4 py-3 text-xs text-[var(--cp-neutral-80)]">
                  {row.evidence}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--cp-neutral-80)]">
                  {row.businessImpact}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--cp-neutral-90)]">
                  {row.fix}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportSection>
  );
}
