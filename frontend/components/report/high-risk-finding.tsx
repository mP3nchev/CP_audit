"use client";

import React from "react"

import { useState } from "react";
import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import {
  ShieldX,
  Eye,
  Scale,
  TrendingDown,
  Wrench,
  ChevronDown,
  ChevronUp,
  Network,
  BadgeCheck,
  Gauge,
} from "lucide-react";

interface Evidence {
  type: string;
  domain: string;
  url: string;
  timing: string;
}

interface FindingProps {
  id: string;
  number: number;
  headline: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: "High" | "Medium" | "Low";
  confidenceReason: string;
  observation: string;
  legalContext: string;
  businessRisk: string;
  recommendation: string;
  effort: "Small" | "Medium" | "Large";
  evidence?: Evidence[];
  totalEvidenceCount?: number;
}

export function HighRiskFinding({
  id,
  number,
  headline,
  severity,
  confidence,
  confidenceReason,
  observation,
  legalContext,
  businessRisk,
  recommendation,
  effort,
  evidence,
  totalEvidenceCount,
}: FindingProps) {
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  const effortColors = {
    Small: "bg-[var(--cp-success-light)] text-[var(--cp-success)]",
    Medium: "bg-[var(--cp-warning-light)] text-[var(--cp-warning)]",
    Large: "bg-[var(--cp-error-light)] text-[var(--cp-error)]",
  };

  return (
    <ReportSection
      id={id}
      title={`Finding #${number}: ${headline}`}
      subtitle="High-risk compliance violation requiring immediate action"
      icon={<ShieldX className="h-5 w-5" />}
    >
      {/* Severity + Confidence row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <SeverityBadge severity={severity} />
        <div className="flex items-center gap-1.5 rounded-full bg-[var(--cp-blue-15)] px-3 py-1">
          <BadgeCheck className="h-3.5 w-3.5 text-[var(--cp-blue-100)]" />
          <span className="text-xs font-semibold text-[var(--cp-blue-150)]">
            {confidence} Confidence
          </span>
        </div>
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${effortColors[effort]}`}>
          <Gauge className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">
            Effort: {effort}
          </span>
        </div>
      </div>

      {/* Content blocks */}
      <div className="space-y-4">
        {/* What We Observed */}
        <FindingBlock
          icon={<Eye className="h-4 w-4 text-[var(--cp-blue-100)]" />}
          title="What We Observed"
          borderColor="border-l-[var(--cp-blue-100)]"
        >
          <p className="text-sm text-[var(--cp-neutral-90)] leading-relaxed">
            {observation}
          </p>
        </FindingBlock>

        {/* Why This Violates GDPR */}
        <FindingBlock
          icon={<Scale className="h-4 w-4 text-[var(--cp-neutral-90)]" />}
          title="Legal Context"
          borderColor="border-l-[var(--cp-neutral-80)]"
        >
          <p className="text-xs text-[var(--cp-neutral-80)] leading-relaxed">
            {legalContext}
          </p>
        </FindingBlock>

        {/* Business Risk */}
        <FindingBlock
          icon={<TrendingDown className="h-4 w-4 text-[var(--cp-error)]" />}
          title="Impact on Business"
          borderColor="border-l-[var(--cp-error)]"
        >
          <p className="text-sm text-[var(--cp-neutral-90)] leading-relaxed">
            {businessRisk}
          </p>
        </FindingBlock>

        {/* Recommendation */}
        <FindingBlock
          icon={<Wrench className="h-4 w-4 text-[var(--cp-success)]" />}
          title="Recommendation"
          borderColor="border-l-[var(--cp-success)]"
        >
          <p className="text-sm text-[var(--cp-neutral-90)] leading-relaxed">
            {recommendation}
          </p>
        </FindingBlock>

        {/* Evidence block (collapsible) */}
        {evidence && evidence.length > 0 && (
          <div className="rounded-xl border border-[var(--cp-neutral-40)] bg-[var(--cp-neutral-20)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--cp-neutral-40)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-[var(--cp-error)]" />
                  <h4 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
                    Evidence: Top Network Requests
                  </h4>
                  {totalEvidenceCount && (
                    <span className="text-xs text-[var(--cp-neutral-80)]">
                      ({totalEvidenceCount} total)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllEvidence(!showAllEvidence)}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--cp-blue-100)] hover:bg-[var(--cp-blue-15)] transition-colors"
                >
                  {showAllEvidence ? "Collapse" : "View Full List"}
                  {showAllEvidence ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <div className="divide-y divide-[var(--cp-neutral-40)]" data-print-expand>
              {(showAllEvidence ? evidence : evidence.slice(0, 3)).map(
                (item) => (
                  <div key={item.url} className="flex items-center gap-4 px-4 py-3">
                    <span className="shrink-0 rounded bg-[var(--cp-error-light)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--cp-error)]">
                      {item.type}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--cp-neutral-100)] truncate">
                        {item.domain}
                      </p>
                      <p className="text-[10px] text-[var(--cp-neutral-80)] truncate font-mono">
                        {item.url}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-mono text-[var(--cp-neutral-80)]">
                      {item.timing}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        {/* Confidence reason */}
        <p className="text-xs text-[var(--cp-neutral-80)] italic leading-relaxed">
          Confidence: {confidenceReason}
        </p>
      </div>
    </ReportSection>
  );
}

function FindingBlock({
  icon,
  title,
  borderColor,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  borderColor: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--cp-neutral-40)] border-l-4 ${borderColor} bg-[var(--cp-white)] p-4`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h4 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
          {title}
        </h4>
      </div>
      {children}
    </div>
  );
}
