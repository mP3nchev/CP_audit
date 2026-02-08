"use client";

import React, { useState } from "react";
import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import type { PolicyTier, PrivacyPolicyAnalysis } from "@/types/report";
import {
  FileText,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

function StatusIcon({ status }: { status: "pass" | "fail" | "warning" }) {
  switch (status) {
    case "pass":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--cp-success)]" />;
    case "fail":
      return <XCircle className="h-4 w-4 shrink-0 text-[var(--cp-error)]" />;
    case "warning":
      return <AlertCircle className="h-4 w-4 shrink-0 text-[var(--cp-warning)]" />;
  }
}

function TierSection({ tier }: { tier: PolicyTier }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--cp-neutral-40)] overflow-hidden print-avoid-break">
      {/* Tier header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between bg-[var(--cp-neutral-20)] px-5 py-3.5 text-left hover:bg-[var(--cp-blue-5)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)]">
            {tier.name}
          </h3>
          <SeverityBadge severity={tier.severity} label={`${tier.percentage}%`} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--cp-neutral-80)]">
            {tier.earnedPoints}/{tier.maxPoints} pts
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[var(--cp-neutral-80)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--cp-neutral-80)]" />
          )}
        </div>
      </button>

      {/* Tier criteria (collapsible on screen, always visible in print) */}
      <div
        className={expanded ? "block" : "hidden"}
        data-print-expand
      >
        <div className="bg-[var(--cp-blue-5)] divide-y divide-[var(--cp-neutral-40)]">
          {tier.criteria.map((criterion) => (
            <div
              key={criterion.name}
              className="px-5 py-3.5 bg-[var(--cp-white)]"
            >
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="flex items-start gap-2.5 flex-1">
                  <StatusIcon status={criterion.status} />
                  <span className="text-sm font-medium text-[var(--cp-neutral-100)]">
                    {criterion.name}
                  </span>
                </div>
                <span className="shrink-0 text-xs font-semibold text-[var(--cp-neutral-80)] tabular-nums">
                  {criterion.score}/{criterion.maxScore}
                </span>
              </div>
              <p className="ml-6.5 text-xs text-[var(--cp-neutral-80)] leading-relaxed pl-[26px]">
                {criterion.explanation}
              </p>
            </div>
          ))}
        </div>

        {/* Tier subtotal */}
        <div className="flex items-center justify-between bg-[var(--cp-neutral-20)] px-5 py-3 border-t border-[var(--cp-neutral-40)]">
          <span className="text-xs font-semibold text-[var(--cp-neutral-100)]">
            {tier.name.split(" - ")[0]} Subtotal:
          </span>
          <span className="text-xs font-bold text-[var(--cp-neutral-100)]">
            {tier.percentage}%
          </span>
        </div>
      </div>
    </div>
  );
}

export function PrivacyPolicyAnalysis({ privacyPolicyAnalysis }) {
  const { tiers, finalScore, finalTotal } = privacyPolicyAnalysis;

  const totalCriteria = tiers.reduce((acc, t) => acc + t.criteria.length, 0);
  const passedCriteria = tiers.reduce(
    (acc, t) => acc + t.criteria.filter((c) => c.status === "pass").length,
    0,
  );
  const failedCriteria = tiers.reduce(
    (acc, t) => acc + t.criteria.filter((c) => c.status === "fail").length,
    0,
  );

  const finalPercentage =
    finalTotal > 0 ? Math.round((finalScore / finalTotal) * 100) : 0;

  return (
    <ReportSection
      id="privacy-policy"
      title="Privacy Policy Analysis"
      subtitle="Compliance criteria evaluation with detailed explanations"
      icon={<FileText className="h-5 w-5" />}
    >
      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <div className="rounded-xl bg-[var(--cp-neutral-20)] px-4 py-3 text-center">
          <p className="text-2xl font-bold text-[var(--cp-neutral-100)]">{totalCriteria}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--cp-neutral-80)]">
            Total Criteria
          </p>
        </div>
        <div className="rounded-xl bg-[var(--cp-error-light)] px-4 py-3 text-center">
          <p className="text-2xl font-bold text-[var(--cp-error)]">{failedCriteria}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--cp-error)]">
            Failed
          </p>
        </div>
        <div className="rounded-xl bg-[var(--cp-success-light)] px-4 py-3 text-center">
          <p className="text-2xl font-bold text-[var(--cp-success)]">{passedCriteria}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--cp-success)]">
            Passed
          </p>
        </div>
        <div className="rounded-xl bg-[var(--cp-blue-15)] px-4 py-3 text-center">
          <p className="text-2xl font-bold text-[var(--cp-blue-100)]">
            {tiers.length}
          </p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--cp-blue-150)]">
            Tiers Evaluated
          </p>
        </div>
      </div>

      {/* Tier sections */}
      <div className="space-y-4">
        {tiers.map((tier) => (
          <TierSection key={tier.id} tier={tier} />
        ))}
      </div>

      {/* Final score block */}
      <div className="mt-6 rounded-xl overflow-hidden">
        {/* Score bar background */}
        <div className="relative bg-[var(--cp-neutral-100)] px-6 py-6 text-center">
          {/* Progress bar */}
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="h-full bg-[var(--cp-blue-200)] transition-all duration-500"
              style={{ width: `${finalPercentage}%` }}
            />
          </div>
          <div className="relative z-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--cp-blue-40)] mb-2">
              Final Privacy Policy Score
            </p>
            <p className="text-5xl font-bold text-[var(--cp-white)] tabular-nums">
              {finalPercentage}%
            </p>
            <p className="text-sm text-[var(--cp-blue-40)] mt-1">
              ({finalScore}/{finalTotal} points)
            </p>
          </div>
        </div>
        {/* Risk classification */}
        <div className="bg-[var(--cp-error-light)] border border-[var(--cp-error)]/20 px-6 py-3 text-center">
          <p className="text-xs font-semibold text-[var(--cp-error)]">
            {finalPercentage === 0
              ? "Policy appears missing, inaccessible, or does not address any evaluated criteria"
              : finalPercentage < 30
                ? "Critical: Major compliance gaps requiring immediate attention"
                : finalPercentage < 60
                  ? "High Risk: Significant compliance gaps identified"
                  : finalPercentage < 80
                    ? "Medium Risk: Some compliance areas need improvement"
                    : "Good: Policy meets most compliance requirements"}
          </p>
        </div>
      </div>
    </ReportSection>
  );
}
