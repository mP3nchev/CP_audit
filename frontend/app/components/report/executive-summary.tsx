import React from "react"
import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import {
  AlertTriangle,
  TrendingUp,
  Route,
  ShieldAlert,
  Clock,
  CalendarCheck,
  CalendarClock,
} from "lucide-react";

export function ExecutiveSummary({ executive }) {
  return (
    <ReportSection
      id="executive-summary"
      title="Executive Summary"
      subtitle="Business-first risk overview"
      icon={<AlertTriangle className="h-5 w-5" />}
    >
      {/* Status banner */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--cp-error-light)] border border-[var(--cp-error)]/20 px-5 py-4">
        <ShieldAlert className="h-5 w-5 text-[var(--cp-error)]" />
        <div>
          <p className="text-sm font-bold text-[var(--cp-error)]">
            Compliance Status: {executive.complianceStatus}
          </p>
          <p className="text-xs text-[var(--cp-error)]/80">
            {executive.statusDescription}
          </p>
        </div>
      </div>

      {/* 3 summary cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 mb-6">
        {/* Top Findings card */}
        <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-4 w-4 text-[var(--cp-error)]" />
            <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
              Top Findings
            </h3>
          </div>
          <ul className="space-y-3">
            {executive.topFindings.map((f) => (
              <li key={f.title} className="flex items-start gap-2">
                <SeverityBadge severity={f.severity} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--cp-neutral-100)]">
                    {f.title}
                  </p>
                  <p className="text-xs text-[var(--cp-neutral-80)] leading-relaxed mt-0.5">
                    {f.summary}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Business Impact card */}
        <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-[var(--cp-warning)]" />
            <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
              What This Means for Your Business
            </h3>
          </div>
          <ul className="space-y-3">
            {executive.businessImpact.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cp-warning)]" />
                <p className="text-sm text-[var(--cp-neutral-90)] leading-relaxed">
                  {item}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Mini Roadmap card */}
        <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Route className="h-4 w-4 text-[var(--cp-blue-100)]" />
            <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
              Remediation Roadmap
            </h3>
          </div>
          <div className="space-y-3">
            <RoadmapItem
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Within 48 hours"
              description={executive.miniRoadmap.immediate}
              urgency="critical"
            />
            <RoadmapItem
              icon={<CalendarCheck className="h-3.5 w-3.5" />}
              label="Within 2 weeks"
              description={executive.miniRoadmap.twoWeeks}
              urgency="high"
            />
            <RoadmapItem
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              label="Within 30 days"
              description={executive.miniRoadmap.thirtyDays}
              urgency="medium"
            />
          </div>
        </div>
      </div>
    </ReportSection>
  );
}

function RoadmapItem({
  icon,
  label,
  description,
  urgency,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  urgency: "critical" | "high" | "medium";
}) {
  const colors = {
    critical: "border-l-[var(--cp-error)] bg-[var(--cp-error-light)]",
    high: "border-l-[var(--cp-warning)] bg-[var(--cp-warning-light)]",
    medium: "border-l-[var(--cp-blue-100)] bg-[var(--cp-blue-15)]",
  };
  return (
    <div className={`rounded-lg border-l-4 px-3 py-2.5 ${colors[urgency]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[var(--cp-neutral-90)]">{icon}</span>
        <span className="text-xs font-semibold text-[var(--cp-neutral-100)]">{label}</span>
      </div>
      <p className="text-xs text-[var(--cp-neutral-90)] leading-relaxed">
        {description}
      </p>
    </div>
  );
}
