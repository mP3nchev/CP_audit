"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Shield,
  AlertTriangle,
  Microscope,
  ShieldX,
  ListChecks,
  Cookie,
  Scale,
  Fingerprint,
  Route,
  Handshake,
  Printer,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";

const sections = [
  { id: "cover", label: "Cover", icon: Shield },
  { id: "executive-summary", label: "Executive Summary", icon: AlertTriangle },
  { id: "scope", label: "Scope & Methodology", icon: Microscope },
  { id: "finding-1", label: "Finding #1: Pre-Consent Tracking", icon: ShieldX },
  { id: "finding-2", label: "Finding #2: Missing Reject Button", icon: ShieldX },
  { id: "medium-findings", label: "Additional Findings", icon: ListChecks },
  { id: "privacy-policy", label: "Privacy Policy Analysis", icon: FileText },
  { id: "cookie-inventory", label: "Cookie Inventory", icon: Cookie },
  { id: "compliance-matrix", label: "Compliance Matrix", icon: Scale },
  { id: "consent-mode-v2", label: "Consent Mode V2", icon: Fingerprint },
  { id: "roadmap", label: "Remediation Roadmap", icon: Route },
  { id: "next-steps", label: "Next Steps", icon: Handshake },
];

export function SidebarNav() {
  const [activeSection, setActiveSection] = useState("cover");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 },
    );

    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <nav
      className={cn(
        "no-print sticky top-6 hidden h-fit max-h-[calc(100vh-3rem)] lg:flex flex-col self-start transition-all duration-300",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div className="flex flex-col rounded-2xl border border-[var(--cp-neutral-40)] bg-[var(--cp-white)] shadow-sm overflow-hidden max-h-[calc(100vh-3rem)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--cp-neutral-40)] bg-[var(--cp-neutral-100)] px-4 py-3">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[var(--cp-blue-80)]" />
              <span className="text-xs font-bold text-[var(--cp-white)] tracking-wide">
                REPORT NAV
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--cp-neutral-60)] hover:text-[var(--cp-white)] transition-colors"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Section links */}
        <div className="p-2 flex flex-col gap-0.5 overflow-y-auto flex-1">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                title={collapsed ? section.label : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-all duration-150",
                  isActive
                    ? "bg-[var(--cp-blue-15)] text-[var(--cp-blue-100)] font-semibold"
                    : "text-[var(--cp-neutral-80)] hover:bg-[var(--cp-neutral-20)] hover:text-[var(--cp-neutral-100)]",
                  collapsed && "justify-center px-2",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive && "text-[var(--cp-blue-100)]")} />
                {!collapsed && (
                  <span className="truncate">{section.label}</span>
                )}
              </a>
            );
          })}
        </div>

        {/* Print button */}
        <div className="border-t border-[var(--cp-neutral-40)] p-2">
          <button
            type="button"
            onClick={() => window.print()}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg bg-[var(--cp-blue-100)] px-3 py-2 text-xs font-semibold text-[var(--cp-white)] hover:bg-[var(--cp-blue-150)] transition-colors",
              collapsed && "justify-center px-2",
            )}
          >
            <Printer className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span>Export PDF</span>}
          </button>
        </div>
      </div>
    </nav>
  );
}
