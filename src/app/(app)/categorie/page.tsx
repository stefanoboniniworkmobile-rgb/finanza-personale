import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getActiveHolder } from "@/lib/holder";
import {
  CategorieClient,
  type CategoriaRow,
} from "@/components/categorie/CategorieClient";
import { ymKey, shiftYm } from "@/lib/format";

type SearchParams = Promise<{ tipo?: "income" | "expense" | "all" }>;

const MODES_NEED_HISTORY = new Set([
  "AVG_3M",
  "AVG_6M",
  "AVG_12M",
  "PREV_MONTH",
  "SAME_MONTH_LY",
  "MAX_3M",
]);

export default async function CategoriePage(props: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;

  const sp = await props.searchParams;
  const tipo = sp.tipo ?? "all";

  const cats = await prisma.category.findMany({
    where: {
      holderId,
      ...(tipo !== "all" ? { type: tipo } : {}),
    },
    include: { _count: { select: { transactions: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  // Carico tutte le transazioni per calcolare totali mensili (mappa cat → ym → amount)
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
  const period = ymKey(new Date());

  const rows: CategoriaRow[] = cats.map((c) => {
    const totals = monthlyByCat[c.id] ?? {};
    const computed = c.hasBudget
      ? computeBudget(c.budgetMode as any, period, totals, c.manualBudget)
      : 0;
    return {
      id: c.id,
      name: c.name,
      type: c.type as "income" | "expense",
      showInDashboard: c.showInDashboard,
      hasBudget: c.hasBudget,
      budgetMode: c.budgetMode,
      manualBudget: c.manualBudget,
      txCount: c._count.transactions,
      computedBudget: computed,
      spentCurrentPeriod: totals[period] ?? 0,
      isTransfer: c.isTransfer,
      counterpartCategoryId: c.counterpartCategoryId,
    };
  });

  // Lista compatta di tutte le categorie dell'Holder per popolare la select
  // "Causale di contropartita" nella dialog. Non rispetta il filtro di tipo
  // (l'utente filtra per visualizzare la tabella ma deve poter scegliere una
  // contropartita di QUALSIASI tipo nella dialog).
  const allCatsForCounterpart =
    tipo === "all"
      ? cats.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type as "income" | "expense",
        }))
      : (
          await prisma.category.findMany({
            where: { holderId },
            select: { id: true, name: true, type: true },
            orderBy: [{ type: "asc" }, { name: "asc" }],
          })
        ).map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type as "income" | "expense",
        }));

  const counts = {
    total: cats.length,
    income: cats.filter((c) => c.type === "income").length,
    expense: cats.filter((c) => c.type === "expense").length,
    withBudget: cats.filter((c) => c.hasBudget).length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Anagrafica</div>
          <h1 className="text-xl font-semibold tracking-tight">Categorie</h1>
        </div>
        <div className="text-xs text-sub">
          {counts.total} totali · {counts.income} entrate · {counts.expense} uscite ·{" "}
          {counts.withBudget} con budget
        </div>
      </div>

      <form
        action="/categorie"
        className="panel p-3 mb-3 flex flex-wrap gap-2 items-end"
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-sub font-semibold">
            Filtra tipo
          </span>
          <select
            name="tipo"
            defaultValue={tipo}
            className="input !h-8 !py-0 min-w-[140px]"
          >
            <option value="all">Tutte</option>
            <option value="expense">Solo uscite</option>
            <option value="income">Solo entrate</option>
          </select>
        </label>
        <button type="submit" className="btn !h-8 !text-xs">
          Applica
        </button>
        <a href="/categorie" className="btn-ghost !h-8 !text-xs">
          Reset
        </a>
      </form>

      <CategorieClient rows={rows} counterpartOptions={allCatsForCounterpart} />

      <div className="mt-4 panel p-4 text-xs text-sub leading-relaxed">
        <div className="font-medium text-ink mb-1">Come funzionano i budget</div>
        Spunta <em>Budget attivo</em> sulle categorie da monitorare e scegli la{" "}
        <strong>modalità di calcolo</strong>: l'importo viene proposto in
        automatico in base allo storico (media 3/6/12 mesi, mese precedente,
        stesso mese anno scorso, massimo). Modificando manualmente il tetto
        dalla scheda, la modalità passa a <em>Manuale</em> e l'importo è
        quello che decidi tu. Le categorie senza budget non compaiono nel
        pannello Budget della dashboard.
      </div>
    </div>
  );
}

/** Versione locale del calcolo budget — clone per evitare round-trip. */
function computeBudget(
  mode: string,
  period: string,
  monthlyTotals: Record<string, number>,
  manualAmount: number | null,
): number {
  if (mode === "MANUAL") return manualAmount ?? 0;
  if (mode === "ACTUAL_MONTH") return monthlyTotals[period] || 0;
  const lastN = (n: number) =>
    Array.from({ length: n }, (_, i) => shiftYm(period, i + 1));
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
      raw = monthlyTotals[shiftYm(period, 1)] || 0;
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
