"use client";

import { useState } from "react";

/**
 * Tab della dashboard. I KPI restano fuori (sempre visibili); qui sotto
 * mostriamo una sola sezione alla volta per evitare lo scroll.
 *
 * Il contenuto di ogni tab è renderizzato lato server nella page e passato
 * come React node: questo componente gestisce solo quale mostrare.
 */
type TabKey = "panoramica" | "conti" | "budget" | "movimenti";

const TABS: { key: TabKey; label: string }[] = [
  { key: "panoramica", label: "Panoramica" },
  { key: "conti", label: "Conti" },
  { key: "budget", label: "Budget" },
  { key: "movimenti", label: "Movimenti" },
];

export function DashboardTabs({
  panoramica,
  conti,
  budget,
  movimenti,
}: {
  panoramica: React.ReactNode;
  conti: React.ReactNode;
  budget: React.ReactNode;
  movimenti: React.ReactNode;
}) {
  const [active, setActive] = useState<TabKey>("panoramica");
  const content: Record<TabKey, React.ReactNode> = {
    panoramica,
    conti,
    budget,
    movimenti,
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Sezioni dashboard"
        className="flex gap-1 border-b border-[var(--line)] mb-4"
      >
        {TABS.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                "px-3.5 py-2 text-sm font-medium -mb-px border-b-2 transition " +
                (on
                  ? "border-[var(--ink)] text-[var(--ink)]"
                  : "border-transparent text-[var(--sub)] hover:text-[var(--ink)]")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">{content[active]}</div>
    </div>
  );
}
