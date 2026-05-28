import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getActiveHolder } from "@/lib/holder";
import { ymKey } from "@/lib/format";
import {
  BudgetGridClient,
  type BudgetGridRow,
} from "@/components/budget/BudgetGridClient";
import { ClearYearButton } from "@/components/budget/ClearYearButton";

type SearchParams = Promise<{
  year?: string;
  tipo?: "income" | "expense" | "all";
  all?: string; // "1" → mostra anche categorie senza hasBudget
}>;

const MONTHS_LABEL = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

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

export default async function BudgetPage(props: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;

  const sp = await props.searchParams;
  const tipo = sp.tipo ?? "expense";
  const showAll = sp.all === "1";

  // Range di anni disponibili (dal primo movimento al successivo all'ultimo)
  const txBoundaries = await prisma.transaction.findMany({
    where: { holderId },
    orderBy: { date: "asc" },
    take: 1,
    select: { date: true },
  });
  const txLast = await prisma.transaction.findFirst({
    where: { holderId },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const firstYear = txBoundaries[0]?.date?.getFullYear() ?? new Date().getFullYear();
  const lastYear = (txLast?.date?.getFullYear() ?? new Date().getFullYear()) + 1;
  const yearOptions: number[] = [];
  for (let y = lastYear; y >= firstYear; y--) yearOptions.push(y);

  const yearParsed = sp.year ? Number(sp.year) : new Date().getFullYear();
  const year =
    Number.isFinite(yearParsed) && yearParsed >= 1900 && yearParsed <= 3000
      ? yearParsed
      : new Date().getFullYear();

  // Categorie filtrate
  const cats = await prisma.category.findMany({
    where: {
      holderId,
      ...(tipo !== "all" ? { type: tipo } : {}),
      ...(!showAll ? { hasBudget: true } : {}),
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  // Tutte le transazioni → totali mensili per categoria (per AVG/MAX/PREV/SAME)
  const allTx = await prisma.transaction.findMany({
    where: { holderId },
    select: { categoryId: true, date: true, amount: true },
  });
  const monthlyByCat: Record<string, Record<string, number>> = {};
  for (const t of allTx) {
    const ym = ymKey(t.date);
    monthlyByCat[t.categoryId] ??= {};
    monthlyByCat[t.categoryId][ym] = (monthlyByCat[t.categoryId][ym] || 0) + t.amount;
  }

  // Override per l'anno selezionato
  const overrides = await prisma.monthlyBudgetOverride.findMany({
    where: { holderId, year },
    select: { categoryId: true, month: true, amount: true },
  });
  const overrideMap: Record<string, Record<number, number>> = {};
  for (const o of overrides) {
    overrideMap[o.categoryId] ??= {};
    overrideMap[o.categoryId][o.month] = o.amount;
  }

  // Costruisco righe della griglia
  const rows: BudgetGridRow[] = cats.map((c) => {
    const totals = monthlyByCat[c.id] ?? {};
    const months: BudgetGridRow["months"] = [];
    for (let m = 1; m <= 12; m++) {
      const period = `${year}-${String(m).padStart(2, "0")}`;
      const auto = c.hasBudget
        ? computeBudgetForRow(c.budgetMode, period, totals, c.manualBudget)
        : 0;
      const override = overrideMap[c.id]?.[m];
      const effective = override ?? auto;
      const spent = totals[period] ?? 0;
      months.push({
        month: m,
        auto,
        override: override ?? null,
        effective,
        spent,
      });
    }
    const yearAuto = months.reduce((s, x) => s + x.auto, 0);
    const yearEffective = months.reduce((s, x) => s + x.effective, 0);
    const yearSpent = months.reduce((s, x) => s + x.spent, 0);
    const overrideCount = months.filter((m) => m.override !== null).length;
    return {
      id: c.id,
      name: c.name,
      type: c.type as "income" | "expense",
      hasBudget: c.hasBudget,
      budgetMode: c.budgetMode,
      budgetModeLabel: MODE_LABEL[c.budgetMode] ?? c.budgetMode,
      manualBudget: c.manualBudget,
      monthlyTotals: totals,
      months,
      yearAuto,
      yearEffective,
      yearSpent,
      overrideCount,
    };
  });

  // Totali colonna (per ogni mese e anno)
  const totals = {
    perMonth: Array.from({ length: 12 }, (_, i) => ({
      effective: rows.reduce((s, r) => s + r.months[i].effective, 0),
      spent: rows.reduce((s, r) => s + r.months[i].spent, 0),
    })),
    yearEffective: rows.reduce((s, r) => s + r.yearEffective, 0),
    yearSpent: rows.reduce((s, r) => s + r.yearSpent, 0),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="min-w-0">
          <div className="text-xs text-sub">Pianificazione</div>
          <h1 className="text-xl font-semibold tracking-tight">Budget {year}</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs text-sub">
            {rows.length} categorie ·{" "}
            {rows.reduce((s, r) => s + r.overrideCount, 0)} override
          </div>
          <ClearYearButton year={year} />
        </div>
      </div>

      {/* Filtri */}
      <form action="/budget" className="panel p-3 mb-3 flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-sub font-semibold">
            Anno
          </span>
          <select
            name="year"
            defaultValue={String(year)}
            className="input !h-8 !py-0 min-w-[100px]"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-sub font-semibold">
            Tipo
          </span>
          <select
            name="tipo"
            defaultValue={tipo}
            className="input !h-8 !py-0 min-w-[140px]"
          >
            <option value="expense">Solo uscite</option>
            <option value="income">Solo entrate</option>
            <option value="all">Tutte</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 mb-1 ml-2 cursor-pointer">
          <input
            type="checkbox"
            name="all"
            value="1"
            defaultChecked={showAll}
            className="accent-brand-500"
          />
          <span className="text-xs text-ink2">
            Mostra anche categorie senza budget attivo
          </span>
        </label>
        <button type="submit" className="btn !h-8 !text-xs">
          Applica filtri
        </button>
        <a href="/budget" className="btn-ghost !h-8 !text-xs">
          Pulisci filtri
        </a>
      </form>

      <BudgetGridClient
        year={year}
        monthLabels={MONTHS_LABEL}
        rows={rows}
        totals={totals}
      />

      <div className="mt-4 panel p-4 text-xs text-sub leading-relaxed">
        <div className="font-medium text-ink mb-1">Come funziona</div>
        Ogni cella mostra il <strong>budget effettivo</strong> (in alto) e lo{" "}
        <strong>speso</strong> di quel mese (in basso, in grigio). Senza override, il
        budget viene calcolato automaticamente dalla modalità della categoria; un
        valore in <strong>grassetto col puntino</strong> indica un{" "}
        <em>override manuale</em> per quel mese. Click su una cella per modificare,
        cancellare l'override o applicare lo stesso importo a tutti i mesi
        dell'anno.
      </div>
    </div>
  );
}

/** Clone locale di lib/budget.ts per evitare round-trip. */
function computeBudgetForRow(
  mode: string,
  period: string,
  monthlyTotals: Record<string, number>,
  manualAmount: number | null,
): number {
  if (mode === "MANUAL") return manualAmount ?? 0;
  if (mode === "ACTUAL_MONTH") return monthlyTotals[period] || 0;
  const shift = (yyyymm: string, back: number): string => {
    let [y, m] = yyyymm.split("-").map(Number);
    m -= back;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  };
  const lastN = (n: number) =>
    Array.from({ length: n }, (_, i) => shift(period, i + 1));
  const avgOf = (months: string[]) => {
    const vals = months.map((ym) => monthlyTotals[ym]).filter((v) => v && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  let raw = 0;
  switch (mode) {
    case "AVG_3M":
      raw = avgOf(lastN(3));
      break;
    case "AVG_6M":
      raw = avgOf(lastN(6));
      break;
    case "AVG_12M":
      raw = avgOf(lastN(12));
      break;
    case "PREV_MONTH":
      raw = monthlyTotals[shift(period, 1)] || 0;
      break;
    case "SAME_MONTH_LY": {
      const [y, m] = period.split("-").map(Number);
      raw = monthlyTotals[`${y - 1}-${String(m).padStart(2, "0")}`] || 0;
      break;
    }
    case "MAX_3M":
      raw = Math.max(0, ...lastN(3).map((ym) => monthlyTotals[ym] || 0));
      break;
  }
  return Math.ceil(raw / 10) * 10;
}
