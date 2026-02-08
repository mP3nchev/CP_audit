import { ReportSection } from "./report-section";
import {
  Microscope,
  CheckCircle2,
  FlaskConical,
  AlertCircle,
} from "lucide-react";

export function ScopeMethodology({ scope }) {
  return (
    <ReportSection
      id="scope"
      title="Scope & Methodology"
      subtitle="What we tested and how we tested it"
      icon={<Microscope className="h-5 w-5" />}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* What We Tested */}
        <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-neutral-20)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-4 w-4 text-[var(--cp-success)]" />
            <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
              What We Tested
            </h3>
          </div>
          <ul className="space-y-2">
            {scope.whatWeTested.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cp-blue-100)]" />
                <span className="text-sm text-[var(--cp-neutral-90)] leading-relaxed">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* How We Tested */}
        <div className="space-y-3">
          {scope.howWeTested.map((method) => (
            <div
              key={method.method}
              className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-4"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-[var(--cp-blue-100)]" />
                <h4 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
                  {method.method}
                </h4>
              </div>
              <p className="text-xs text-[var(--cp-neutral-80)] leading-relaxed">
                {method.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Limitations */}
      <div className="mt-6 rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-warning-light)] p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-4 w-4 text-[var(--cp-warning)]" />
          <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
            Limitations
          </h3>
        </div>
        <ul className="space-y-1.5">
          {scope.limitations.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cp-warning)]" />
              <span className="text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                {item}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ReportSection>
  );
}
