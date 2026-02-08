import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import {
  Route,
  Zap,
  Palette,
  FileText,
  ShieldCheck,
  Clock,
} from "lucide-react";

const phases = [
  {
    id: "phase-1",
    label: "Phase 1",
    timeline: "0 - 48 hours",
    title: "Stop Unlawful Tracking",
    severity: "critical" as const,
    icon: <Zap className="h-5 w-5" />,
    deliverables: [
      "Disable all non-essential scripts pending consent",
      "Set Google Consent Mode V2 defaults to 'denied'",
      "Configure tag manager to respect consent signals before firing",
      "Verify no tracking requests fire before user interaction",
    ],
    effort: "Medium",
    owner: "Development Team + CMP Administrator",
  },
  {
    id: "phase-2",
    label: "Phase 2",
    timeline: "0 - 14 days",
    title: "Banner & Consent UX Compliance",
    severity: "high" as const,
    icon: <Palette className="h-5 w-5" />,
    deliverables: [
      "Add 'Reject All' button with equal visual prominence on first layer",
      "Implement granular category controls (Necessary, Analytics, Marketing, Social)",
      "Ensure consent withdrawal is accessible from every page",
      "Test banner across mobile and desktop breakpoints",
    ],
    effort: "Small-Medium",
    owner: "UX Designer + CMP Administrator",
  },
  {
    id: "phase-3",
    label: "Phase 3",
    timeline: "0 - 30 days",
    title: "Policy, Declaration & Governance",
    severity: "medium" as const,
    icon: <FileText className="h-5 w-5" />,
    deliverables: [
      "Draft GDPR-compliant privacy policy covering all Art. 12-14 requirements",
      "Publish comprehensive cookie policy with all 10+ cookies declared",
      "Establish Data Processing Agreements (DPAs) with all third-party vendors",
      "Implement quarterly cookie audit and compliance review process",
    ],
    effort: "Medium-Large",
    owner: "Legal / DPO + Development Team",
  },
];

export function Roadmap() {
  return (
    <ReportSection
      id="roadmap"
      title="Recommended Actions & Roadmap"
      subtitle="Phased remediation plan prioritized by risk and effort"
      icon={<Route className="h-5 w-5" />}
    >
      <div className="space-y-5">
        {phases.map((phase, idx) => (
          <div
            key={phase.id}
            className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] overflow-hidden print-avoid-break"
          >
            {/* Phase header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cp-neutral-40)] bg-[var(--cp-neutral-20)] px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cp-blue-15)] text-[var(--cp-blue-100)]">
                  {phase.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--cp-blue-100)]">
                      {phase.label}
                    </span>
                    <SeverityBadge severity={phase.severity} />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
                    {phase.title}
                  </h3>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--cp-neutral-80)]">
                <Clock className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">{phase.timeline}</span>
              </div>
            </div>

            {/* Phase body */}
            <div className="px-5 py-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--cp-neutral-80)] mb-2">
                Deliverables
              </h4>
              <ul className="space-y-2 mb-4">
                {phase.deliverables.map((d) => (
                  <li key={d} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--cp-blue-100)]" />
                    <span className="text-sm text-[var(--cp-neutral-90)] leading-relaxed">
                      {d}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-4 text-xs text-[var(--cp-neutral-80)]">
                <span>
                  <span className="font-semibold text-[var(--cp-neutral-100)]">Effort:</span>{" "}
                  {phase.effort}
                </span>
                <span>
                  <span className="font-semibold text-[var(--cp-neutral-100)]">Owner:</span>{" "}
                  {phase.owner}
                </span>
              </div>
            </div>

            {/* Visual connector */}
            {idx < phases.length - 1 && (
              <div className="flex justify-center py-0">
                <div className="h-0 w-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-[var(--cp-blue-60)]" />
              </div>
            )}
          </div>
        ))}
      </div>
    </ReportSection>
  );
}
