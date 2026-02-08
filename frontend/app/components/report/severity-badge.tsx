import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low" | "pass" | "fail" | "warning";

const severityConfig: Record<
  Severity,
  { label: string; bg: string; text: string }
> = {
  critical: {
    label: "Critical",
    bg: "bg-[var(--cp-error-light)]",
    text: "text-[var(--cp-error)]",
  },
  high: {
    label: "High",
    bg: "bg-[var(--cp-warning-light)]",
    text: "text-[var(--cp-warning)]",
  },
  medium: {
    label: "Medium",
    bg: "bg-[var(--cp-blue-15)]",
    text: "text-[var(--cp-blue-150)]",
  },
  low: {
    label: "Low",
    bg: "bg-[var(--cp-success-light)]",
    text: "text-[var(--cp-success)]",
  },
  pass: {
    label: "Pass",
    bg: "bg-[var(--cp-success-light)]",
    text: "text-[var(--cp-success)]",
  },
  fail: {
    label: "Fail",
    bg: "bg-[var(--cp-error-light)]",
    text: "text-[var(--cp-error)]",
  },
  warning: {
    label: "Warning",
    bg: "bg-[var(--cp-warning-light)]",
    text: "text-[var(--cp-warning)]",
  },
};

export function SeverityBadge({
  severity,
  label,
  className,
}: {
  severity: Severity;
  label?: string;
  className?: string;
}) {
  const config = severityConfig[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase",
        config.bg,
        config.text,
        className,
      )}
    >
      {label ?? config.label}
    </span>
  );
}
