import React from "react"
import Image from "next/image";
import { Globe, Calendar, User, Building2, ScanLine, Shield } from "lucide-react";

export function CoverPage({ meta }) {
  return (
    <section
      id="cover"
      className="scroll-mt-24 print-break-before"
    >
      <div className="rounded-2xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] shadow-sm overflow-hidden">
        {/* Top band - gradient */}
        <div className="px-8 py-10" style={{ background: 'linear-gradient(-133deg, #accef7, #e7edf5)' }}>
          <div className="flex items-center gap-3 mb-6">
            <Image
              src="/craftpolicy-logo.svg"
              alt="CraftPolicy"
              width={101}
              height={53}
              priority
            />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-balance leading-tight lg:text-4xl" style={{ color: 'rgb(1, 117, 255)' }}>
            GDPR & Cookie Consent
            <br />
            Compliance Audit
          </h1>
          <p className="mt-3 text-base" style={{ color: '#4a5568' }}>
            Executive-level compliance assessment with actionable recommendations
          </p>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-1 gap-px bg-[var(--cp-neutral-40)] sm:grid-cols-2 lg:grid-cols-3">
          <DetailCell icon={<Globe className="h-4 w-4" />} label="Website" value={meta.targetUrl} />
          <DetailCell icon={<Calendar className="h-4 w-4" />} label="Scan Date" value={meta.scanDate} />
          <DetailCell icon={<ScanLine className="h-4 w-4" />} label="Audit Type" value={meta.auditType} />
          <DetailCell icon={<User className="h-4 w-4" />} label="Prepared For" value={meta.preparedFor} />
          <DetailCell icon={<Building2 className="h-4 w-4" />} label="Prepared By" value={meta.preparedBy} />
          <DetailCell icon={<Shield className="h-4 w-4" />} label="Scan ID" value={meta.scanId} mono />
        </div>

        {/* Confidence note */}
        <div className="border-t border-[var(--cp-neutral-40)] bg-[var(--cp-blue-5)] px-8 py-4">
          <p className="text-xs text-[var(--cp-neutral-80)] leading-relaxed">
            <span className="font-semibold text-[var(--cp-neutral-100)]">Confidence Level:</span>{" "}
            This audit combines automated network analysis with human-assisted browser verification
            to ensure high-confidence findings. Evidence is captured at the network level and validated
            through real user interaction sessions.
          </p>
        </div>
      </div>
    </section>
  );
}

function DetailCell({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-[var(--cp-white)] px-6 py-4">
      <div className="flex items-center gap-2 text-[var(--cp-neutral-80)] mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p
        className={`text-sm font-medium text-[var(--cp-neutral-100)] ${
          mono ? "font-mono text-xs" : ""
        } break-all`}
      >
        {value}
      </p>
    </div>
  );
}
