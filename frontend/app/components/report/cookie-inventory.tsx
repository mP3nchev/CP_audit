import React from "react"
import { ReportSection } from "./report-section";
import { SeverityBadge } from "./severity-badge";
import { Cookie, AlertTriangle, CheckCircle2 } from "lucide-react";

export function CookieInventory({ cookies }) {

  // Group by vendor
  const byVendor: Record<string, typeof cookies> = {};
  for (const c of cookies) {
    if (!byVendor[c.vendor]) byVendor[c.vendor] = [];
    byVendor[c.vendor].push(c);
  }

  const detected = cookies.length;
  const declared = cookies.filter((c) => c.declared).length;
  const undeclared = detected - declared;

  return (
    <ReportSection
      id="cookie-inventory"
      title="Cookie & Tracker Inventory"
      subtitle="Detected vs. declared cookies grouped by vendor"
      icon={<Cookie className="h-5 w-5" />}
    >
      {/* Gap summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-6">
        <SummaryCard
          label="Cookies Detected"
          value={detected}
          icon={<Cookie className="h-4 w-4 text-[var(--cp-blue-100)]" />}
          bg="bg-[var(--cp-blue-15)]"
        />
        <SummaryCard
          label="Cookies Declared"
          value={declared}
          icon={<CheckCircle2 className="h-4 w-4 text-[var(--cp-success)]" />}
          bg="bg-[var(--cp-success-light)]"
        />
        <SummaryCard
          label="Undeclared (Gap)"
          value={undeclared}
          icon={<AlertTriangle className="h-4 w-4 text-[var(--cp-error)]" />}
          bg="bg-[var(--cp-error-light)]"
        />
      </div>

      {/* Vendor grouped table */}
      <div className="overflow-x-auto print:overflow-visible rounded-xl border border-[var(--cp-neutral-40)]">
        <table className="w-full text-left text-sm print:table-fixed">
          <thead>
            <tr className="bg-[var(--cp-neutral-20)] text-xs font-semibold uppercase tracking-wider text-[var(--cp-neutral-80)]">
              <th className="px-4 py-3">Cookie Name</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Purpose</th>
              <th className="px-4 py-3">Lifespan</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--cp-neutral-40)]">
            {Object.entries(byVendor).map(([vendor, vendorCookies]) =>
              vendorCookies.map((cookie, idx) => (
                <tr
                  key={cookie.name}
                  className="hover:bg-[var(--cp-blue-5)] transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-[var(--cp-neutral-100)]">
                    {cookie.name}
                  </td>
                  {idx === 0 ? (
                    <td
                      className="px-4 py-3 text-xs font-semibold text-[var(--cp-neutral-90)]"
                      rowSpan={vendorCookies.length}
                    >
                      {vendor}
                    </td>
                  ) : null}
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-[var(--cp-blue-15)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--cp-blue-150)]">
                      {cookie.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--cp-neutral-80)]">
                    {cookie.purpose}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--cp-neutral-80)]">
                    {cookie.lifespan}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {cookie.declared ? (
                      <SeverityBadge severity="pass" label="Declared" />
                    ) : (
                      <SeverityBadge severity="fail" label="Undeclared" />
                    )}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </ReportSection>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
}) {
  return (
    <div
      className={`rounded-xl ${bg} px-5 py-4 flex items-center gap-3`}
    >
      {icon}
      <div>
        <p className="text-2xl font-bold text-[var(--cp-neutral-100)]">{value}</p>
        <p className="text-xs font-medium text-[var(--cp-neutral-80)]">{label}</p>
      </div>
    </div>
  );
}
