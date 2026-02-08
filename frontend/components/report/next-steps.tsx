import { ReportSection } from "./report-section";
import {
  Handshake,
  Zap,
  ShieldCheck,
  Eye,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Shield,
} from "lucide-react";

const packages = [
  {
    name: "Quick Fix",
    description:
      "Immediate remediation of critical violations: pre-consent tracking removal and consent banner redesign.",
    includes: [
      "Tag management consent-first configuration",
      "Cookie banner Reject button implementation",
      "Google Consent Mode V2 correct defaults",
      "Post-implementation verification scan",
    ],
    timeline: "1 - 3 business days",
    icon: <Zap className="h-5 w-5" />,
    highlight: false,
  },
  {
    name: "Full Compliance Remediation",
    description:
      "End-to-end GDPR compliance implementation covering all findings in this audit.",
    includes: [
      "Everything in Quick Fix",
      "Privacy policy drafting (GDPR Art. 12-14)",
      "Cookie policy with full vendor declaration",
      "Third-party vendor audit and DPA setup",
      "Consent UX design review",
      "Compliance verification report",
    ],
    timeline: "2 - 4 weeks",
    icon: <ShieldCheck className="h-5 w-5" />,
    highlight: true,
  },
  {
    name: "Ongoing Compliance Monitoring",
    description:
      "Continuous monitoring to ensure sustained compliance as your website evolves.",
    includes: [
      "Monthly automated compliance scans",
      "Quarterly human-assisted verification",
      "Regulatory change alerts and guidance",
      "Cookie audit updates after site changes",
      "Priority support for compliance questions",
    ],
    timeline: "Monthly retainer",
    icon: <Eye className="h-5 w-5" />,
    highlight: false,
  },
];

export function NextSteps() {
  return (
    <ReportSection
      id="next-steps"
      title="Next Steps & Professional Support"
      subtitle="Clear path to compliance — partner, not vendor"
      icon={<Handshake className="h-5 w-5" />}
    >
      {/* Decision-ready closing */}
      <div className="mb-6 space-y-3">
        <div className="rounded-xl border border-[var(--cp-neutral-40)] border-l-4 border-l-[var(--cp-error)] bg-[var(--cp-error-light)] p-4 print-avoid-break">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cp-error)]" />
            <div>
              <h4 className="text-sm font-semibold text-[var(--cp-error)]">
                If you do nothing
              </h4>
              <p className="mt-1 text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                Your website continues to collect data without valid consent, exposing your
                organisation to regulatory fines (up to 4% of annual global turnover), invalid
                advertising data, and increasing risk of formal complaints from privacy advocacy
                organisations such as noyb.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--cp-neutral-40)] border-l-4 border-l-[var(--cp-warning)] bg-[var(--cp-warning-light)] p-4 print-avoid-break">
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cp-warning)]" />
            <div>
              <h4 className="text-sm font-semibold text-[var(--cp-warning)]">
                If you implement Phase 1 only
              </h4>
              <p className="mt-1 text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                You eliminate the highest-risk violation (pre-consent tracking) and significantly
                reduce immediate enforcement exposure. However, remaining gaps in cookie
                declaration, privacy policy, and vendor transparency will continue to accumulate
                risk over time.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--cp-neutral-40)] border-l-4 border-l-[var(--cp-success)] bg-[var(--cp-success-light)] p-4 print-avoid-break">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cp-success)]" />
            <div>
              <h4 className="text-sm font-semibold text-[var(--cp-success)]">
                If you implement full remediation
              </h4>
              <p className="mt-1 text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                Your website achieves demonstrable GDPR compliance, valid consent for all data
                processing, legally sound advertising data, and a governance framework that
                protects against future regulatory changes. This is the recommended path.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Service packages */}
      <h3 className="text-sm font-semibold text-[var(--cp-neutral-100)] mb-4">
        How We Can Help
      </h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {packages.map((pkg) => (
          <div
            key={pkg.name}
            className={`rounded-xl border overflow-hidden print-avoid-break ${
              pkg.highlight
                ? "border-[var(--cp-blue-100)] ring-1 ring-[var(--cp-blue-100)]/20"
                : "border-[var(--cp-neutral-40)]"
            }`}
          >
            {pkg.highlight && (
              <div className="bg-[var(--cp-blue-100)] px-4 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-[var(--cp-white)]">
                Recommended
              </div>
            )}
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cp-blue-15)] text-[var(--cp-blue-100)]">
                  {pkg.icon}
                </div>
                <h4 className="text-sm font-bold text-[var(--cp-neutral-100)]">
                  {pkg.name}
                </h4>
              </div>
              <p className="text-xs text-[var(--cp-neutral-80)] leading-relaxed mb-3">
                {pkg.description}
              </p>
              <h5 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--cp-neutral-80)] mb-2">
                What You Get
              </h5>
              <ul className="space-y-1.5 mb-4">
                {pkg.includes.map((item) => (
                  <li key={item} className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--cp-success)]" />
                    <span className="text-xs text-[var(--cp-neutral-90)] leading-relaxed">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-[var(--cp-neutral-40)] pt-3">
                <span className="text-[10px] font-medium text-[var(--cp-neutral-80)]">
                  {pkg.timeline}
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-[var(--cp-blue-100)]">
                  Learn more <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div className="mt-6 rounded-xl bg-[var(--cp-neutral-20)] px-5 py-4 text-center">
        <p className="text-xs text-[var(--cp-neutral-80)] leading-relaxed">
          This report was prepared by CraftPolicy as an independent compliance assessment.
          All findings are based on evidence collected during the audit period and reflect the
          state of the website at the time of scanning. For questions about this report or to
          discuss remediation options, contact us at{" "}
          <span className="font-semibold text-[var(--cp-blue-100)]">hello@craftpolicy.com</span>
        </p>
      </div>
    </ReportSection>
  );
}
