"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function ReportSection({
  id,
  title,
  subtitle,
  icon,
  children,
  className,
}: {
  id: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24",
        className,
      )}
    >
      <div className="rounded-2xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[var(--cp-neutral-40)] px-6 py-5 bg-[var(--cp-neutral-20)] print-avoid-break">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-blue-15)] text-[var(--cp-blue-100)]">
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--cp-neutral-100)]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-[var(--cp-neutral-80)]">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="px-6 py-6">{children}</div>
      </div>
    </section>
  );
}
