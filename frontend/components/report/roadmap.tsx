import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import {
  Route,
  Zap,
  Palette,
  FileText,
  ShieldCheck,
  Clock,
  CheckCircle2,
} from "lucide-react";
import type { RoadmapPhase } from "@/types/report";

const phaseIcons: Record<string, React.ReactNode> = {
  "phase-1": <Zap className="h-5 w-5" />,
  "phase-2": <Palette className="h-5 w-5" />,
  "phase-3": <FileText className="h-5 w-5" />,
};

export function Roadmap({ roadmap }: { roadmap: RoadmapPhase[] }) {
  const phases = roadmap || [];

  return (
    <ReportSection
      id="roadmap"
      title="Recommended Actions & Roadmap"
      subtitle="Phased remediation plan prioritized by risk and effort"
      icon={<Route className="h-5 w-5" />}
    >
      {phases.length === 0 ? (
        <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] overflow-hidden print-avoid-break">
          <div className="flex items-center gap-4 px-6 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
                No Critical Remediation Actions Required
              </h3>
              <p className="text-sm text-[var(--cp-neutral-80)] mt-0.5">
                All automated checks passed. Continue monitoring with periodic audits to maintain compliance.
              </p>
            </div>
          </div>
        </div>
      ) : (
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
                    {phaseIcons[phase.id] || <FileText className="h-5 w-5" />}
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
      )}
    </ReportSection>
  );
}
