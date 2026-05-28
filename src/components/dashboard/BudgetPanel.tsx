import Link from "next/link";
import type { BudgetRow } from "@/lib/dashboard";
import { fmtN0, fmtPeriodLabel, parsePeriod } from "@/lib/format";

const MODE_LABEL: Record<string, string> = {
  AVG_3M: "Media 3M",
  AVG_6M: "Media 6M",
  AVG_12M: "Media 12M",
  PREV_MONTH: "Mese prec.",
  SAME_MONTH_LY: "Stesso mese a.p.",
  MAX_3M: "Max 3M",
  ACTUAL_MONTH: "Consuntivo",
  MANUAL: "Manuale",
};

export function BudgetPanel({
  rows,
  period,
  tab = "expense",
}: {
  rows: BudgetRow[];
  period: string;
  tab?: "expense" | "income";
}) {
  const filtered = rows.filter((r) => r.type === tab);
  const overCount = filtered.filter((r) => r.status === "err").length;
  const okCount = filtered.filter((r) => r.status === "ok").length;
  const warnCount = filtered.filter((r) => r.status === "warn").length;
  const totalBudget = filtered.reduce((s, r) => s + r.budget, 0);
  const totalSpent = filtered.reduce((s, r) => s + r.spent, 0);

  return (
    <div className="panel overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="font-semibold text-sm">
              Budget · {(() => {
                const { from, to } = parsePeriod(period);
                return fmtPeriodLabel(from, to);
              })()}
            </div>
            <div className="text-xs text-sub">
              {filtered.length} categorie monitorate · semaforica vs storico
            </div>
          </div>
          <div className="seg">
            <Link
              href={`/dashboard?${new URLSearchParams({ period, bt: "expense" }).toString()}`}
              data-active={tab === "expense"}
              scroll={false}
              prefetch={false}
            >
              Uscite
            </Link>
            <Link
              href={`/dashboard?${new URLSearchParams({ period, bt: "income" }).toString()}`}
              data-active={tab === "income"}
              scroll={false}
              prefetch={false}
            >
              Entrate
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="dot bar-ok" /> {okCount} ok
          </span>
          <span className="flex items-center gap-1">
            <span className="dot bar-warn" /> {warnCount} attenzione
          </span>
          <span className="flex items-center gap-1">
            <span className="dot bar-err" /> {overCount} fuori
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-sub text-center">
            Nessun budget attivo per questa vista.
          </div>
        ) : (
          <ul className="divide-y divide-line2">
            {filtered.map((r) => (
              <BudgetItem key={r.categoryId} row={r} />
            ))}
          </ul>
        )}
      </div>

      <div className="px-4 py-3 border-t border-line bg-bg flex items-center justify-between text-xs">
        <span className="text-sub">
          Totale: <span className="num-mono text-ink font-semibold">{fmtN0(totalSpent)}</span> /{" "}
          <span className="num-mono text-ink2">{fmtN0(totalBudget)}</span> €
        </span>
        <a
          href="/categorie"
          className="text-brand-600 font-medium hover:underline"
        >
          Configura categorie →
        </a>
      </div>
    </div>
  );
}

function BudgetItem({ row }: { row: BudgetRow }) {
  const fillPct = Math.min(100, Math.max(0, row.pct * 100));
  const barCls =
    row.status === "ok" ? "bar-ok" : row.status === "warn" ? "bar-warn" : "bar-err";
  const overage = row.spent - row.budget;
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <div className="font-medium text-[13px] truncate flex-1" title={row.categoryName}>
          {row.categoryName}
        </div>
        <span
          className="pill bg-line2 text-ink2"
          title={`Modalità di calcolo: ${MODE_LABEL[row.budgetMode] ?? row.budgetMode}`}
        >
          {MODE_LABEL[row.budgetMode] ?? row.budgetMode}
        </span>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${barCls}`} style={{ width: `${fillPct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px] num-mono">
        <span className={row.status === "err" ? "text-err-600 font-semibold" : "text-sub"}>
          {fmtN0(row.spent)} € / {fmtN0(row.budget)} €
        </span>
        <span
          className={
            row.status === "err"
              ? "text-err-600 font-semibold"
              : row.status === "warn"
                ? "text-warn-600"
                : "text-sub"
          }
        >
          {row.budget > 0
            ? row.type === "expense"
              ? overage > 0
                ? `+${fmtN0(overage)} oltre`
                : `${fmtN0(-overage)} residui`
              : row.spent < row.budget
                ? `${fmtN0(row.budget - row.spent)} mancanti`
                : "target raggiunto"
            : "no storico"}
        </span>
      </div>
    </li>
  );
}
