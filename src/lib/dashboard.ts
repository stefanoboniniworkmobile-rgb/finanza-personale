/**
 * Aggregazioni server-side per la Dashboard.
 * Tutte le funzioni accettano `holderId` (intestatario attivo) e (dove serve) un `period` "YYYY-MM".
 *
 * Convenzioni:
 * - I "giroconti" (categorie "Trasferimento +" / "Trasferimento -") sono ESCLUSI
 *   da entrate/uscite/composizione. Influenzano comunque i saldi conto.
 * - Tutti gli importi sono positivi nel DB; il segno deriva da `type`.
 */
import { prisma } from "@/lib/db";
import {
  ymKey,
  shiftYm,
  monthRange,
  parsePeriod,
  monthsBetween,
  periodDateRange,
} from "@/lib/format";

const TRANSFER_NAMES = new Set(["Trasferimento +", "Trasferimento -"]);

export type DashboardData = {
  period: string; // "YYYY-MM" o "YYYY-MM..YYYY-MM" del periodo selezionato
  periodFrom: string; // primo mese del range
  periodTo: string; // ultimo mese del range
  monthCount: number; // numero di mesi coperti
  prevPeriod: string; // periodo precedente equivalente (di stessa durata)
  hasAnyData: boolean;

  kpi: {
    patrimonioTotal: number; // saldo iniziale + Σ(entrate) - Σ(uscite) globale
    liquidity: number; // patrimonio nei conti liquidity + cash
    savings: number; // patrimonio nei conti savings
    cardsExposure: number; // saldo netto (negativo) sui credit_card del periodo
    entratePeriod: number;
    uscitePeriod: number;
    netto: number; // entrate - uscite
    excludedBalancePeriod: number;
    movimentiTotal: number;
    movimentiPeriod: number;
    daVerificare: number;  // numero di movimenti dell'Holder non ancora riconciliati (globale, non legato al periodo)
    deltaEntrate: number; // % vs periodo precedente
    deltaUscite: number;
  };

  accounts: AccountRow[];

  trend: TrendPoint[]; // ultimi 6 mesi compreso il periodo

  topCategories: CategorySlice[]; // top 6 + Altre, sul periodo, solo uscite

  budgetRows: BudgetRow[];

  recent: RecentRow[];
};

export type AccountRow = {
  id: string;
  name: string;
  type: string;
  notes: string | null;
  initialBalance: number;
  entrate: number; // del periodo
  uscite: number; // del periodo
  saldo: number; // saldo corrente totale (storico)
  movs: number; // n. movimenti totali
};

export type TrendPoint = {
  ym: string; // "YYYY-MM"
  label: string; // "mag '26"
  entrate: number;
  uscite: number;
  netto: number;
};

export type CategorySlice = {
  name: string;
  amount: number;
  pct: number;
  isOther?: boolean;
  hidden?: string[]; // nomi categorie aggregate (per tooltip "Altre")
};

export type BudgetRow = {
  categoryId: string;
  categoryName: string;
  type: "income" | "expense";
  budgetMode: string;
  hasBudget: boolean;
  budget: number; // tetto calcolato (o manualBudget)
  spent: number; // ammontare del periodo (uscite per "expense", entrate per "income")
  pct: number; // 0..1+ (per uscite: spent/budget, per income: spent/budget)
  status: "ok" | "warn" | "err"; // semaforo
};

export type RecentRow = {
  id: string;
  date: Date;
  description: string;
  category: string;
  categoryType: "income" | "expense";
  account: string;
  paymentMethod: string | null;
  amount: number;
  type: "income" | "expense";
};

/** Ritorna il periodo "YYYY-MM" di default: mese corrente se ha dati, altrimenti l'ultimo con dati. */
export async function pickDefaultPeriod(holderId: string): Promise<string> {
  const now = new Date();
  const currentYm = ymKey(now);
  const latest = await prisma.transaction.findFirst({
    where: { holderId },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return currentYm;
  const latestYm = ymKey(latest.date);
  // Se il mese corrente ha almeno un movimento, usalo
  const { from, to } = monthRange(currentYm);
  const inCurrent = await prisma.transaction.count({
    where: { holderId, date: { gte: from, lt: to } },
  });
  return inCurrent > 0 ? currentYm : latestYm;
}

/**
 * Funzione monolitica che restituisce TUTTO ciò che serve alla dashboard,
 * facendo poche query mirate. Il volume dati per utente (~1000 mov/anno) è
 * piccolo: caricare tutto in memoria e aggregare in JS è più semplice e
 * sufficientemente veloce. Se in futuro cresce, si passa a $queryRaw con GROUP BY.
 */
export async function loadDashboard(
  holderId: string,
  period: string,
): Promise<DashboardData> {
  // Il periodo può essere un singolo mese o un range "from..to".
  const { from: pFromYm, to: pToYm } = parsePeriod(period);
  const periodMonths = monthsBetween(pFromYm, pToYm);
  const periodMonthsCount = periodMonths.length;
  const { from: pFrom, to: pTo } = periodDateRange(pFromYm, pToYm);

  // Periodo precedente di stessa durata (per i delta entrate/uscite)
  const prevToYm = shiftYm(pFromYm, 1);
  const prevFromYm = shiftYm(pFromYm, periodMonthsCount);
  const { from: prevFrom, to: prevTo } = periodDateRange(prevFromYm, prevToYm);
  const prevPeriod = prevFromYm === prevToYm ? prevFromYm : `${prevFromYm}..${prevToYm}`;

  // Per gli override: tutti i mesi del range
  const periodYearMonth = periodMonths.map((ym) => {
    const [y, m] = ym.split("-").map(Number);
    return { year: y, month: m };
  });

  const [accounts, categories, allTx, overrides, daVerificare] = await Promise.all([
    prisma.bankAccount.findMany({ where: { holderId }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { holderId } }),
    prisma.transaction.findMany({
      where: { holderId },
      orderBy: { date: "desc" },
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        type: true,
        bankAccountId: true,
        categoryId: true,
        paymentMethodId: true,
      },
    }),
    prisma.monthlyBudgetOverride.findMany({
      where: {
        holderId,
        OR: periodYearMonth.map((ym) => ({ year: ym.year, month: ym.month })),
      },
      select: { categoryId: true, year: true, month: true, amount: true },
    }),
    prisma.transaction.count({ where: { holderId, reconciled: false } }),
  ]);
  // Mappa override: categoryId -> Map<ym, amount>
  const overrideByCatMonth = new Map<string, Map<string, number>>();
  for (const o of overrides) {
    const ym = `${o.year}-${String(o.month).padStart(2, "0")}`;
    if (!overrideByCatMonth.has(o.categoryId)) {
      overrideByCatMonth.set(o.categoryId, new Map());
    }
    overrideByCatMonth.get(o.categoryId)!.set(ym, o.amount);
  }

  const catById = new Map(categories.map((c) => [c.id, c]));
  const accById = new Map(accounts.map((a) => [a.id, a]));

  const paymentMethods = await prisma.paymentMethod.findMany({ where: { holderId } });
  const pmById = new Map(paymentMethods.map((p) => [p.id, p]));

  const isTransfer = (catId: string) => {
    const c = catById.get(catId);
    return c && (c.isTransfer || TRANSFER_NAMES.has(c.name));
  };

  const isVisibleInDashboard = (cat: { showInDashboard: boolean; id: string } | undefined) =>
    !!cat && cat.showInDashboard && !isTransfer(cat.id);

  // ---------- TREND ULTIMI 6 MESI (ancorati all'ultimo mese del range) ----------
  const monthsBack = 5;
  const trendKeys: string[] = [];
  for (let i = monthsBack; i >= 0; i--) trendKeys.push(shiftYm(pToYm, i));
  const trendAcc: Record<string, { entrate: number; uscite: number }> =
    Object.fromEntries(trendKeys.map((k) => [k, { entrate: 0, uscite: 0 }]));

  // ---------- AGGREGAZIONI PERIODO + GLOBALI ----------
  let entratePeriod = 0;
  let uscitePeriod = 0;
  let entratePrev = 0;
  let uscitePrev = 0;
  let excludedBalancePeriod = 0;
  let movimentiPeriod = 0;
  let cardsExposurePeriod = 0;

  // Per saldi conti
  type AccAgg = { entrate: number; uscite: number; saldo: number; movs: number };
  const accAgg = new Map<string, AccAgg>(
    accounts.map((a) => [
      a.id,
      { entrate: 0, uscite: 0, saldo: a.initialBalance, movs: 0 },
    ]),
  );
  // Saldi del periodo (entrate/uscite del periodo per conto)
  const accAggPeriod = new Map<string, { entrate: number; uscite: number }>(
    accounts.map((a) => [a.id, { entrate: 0, uscite: 0 }]),
  );

  // Per top categorie del periodo
  const catSpentPeriod: Record<string, number> = {};

  // Per budget: totali mensili per categoria su tutti i mesi (per le modalità)
  const monthlyTotals: Record<string, Record<string, number>> = {};

  // Per movimenti recenti (top 12 dati già ordinati desc)
  const recent: RecentRow[] = [];

  for (const t of allTx) {
    const cat = catById.get(t.categoryId);
    if (!cat) continue;

    // Saldi globali (giroconti inclusi)
    const a = accAgg.get(t.bankAccountId);
    if (a) {
      a.movs++;
      if (t.type === "income") {
        a.entrate += t.amount;
        a.saldo += t.amount;
      } else {
        a.uscite += t.amount;
        a.saldo -= t.amount;
      }
    }

    const inPeriod = t.date >= pFrom && t.date < pTo;
    const inPrev = t.date >= prevFrom && t.date < prevTo;

    if (inPeriod) {
      const ap = accAggPeriod.get(t.bankAccountId);
      if (ap) {
        if (t.type === "income") ap.entrate += t.amount;
        else ap.uscite += t.amount;
      }
    }

    const visibleInDashboard = isVisibleInDashboard(cat);
    if (!visibleInDashboard && inPeriod) {
      excludedBalancePeriod += t.type === "income" ? t.amount : -t.amount;
    }

    // Esclusi giroconti e categorie nascoste per entrate/uscite/composizione/trend
    if (visibleInDashboard) {
      if (inPeriod) {
        movimentiPeriod++;
        if (t.type === "income") entratePeriod += t.amount;
        else {
          uscitePeriod += t.amount;
          catSpentPeriod[t.categoryId] = (catSpentPeriod[t.categoryId] || 0) + t.amount;
        }
      }
      if (inPrev) {
        if (t.type === "income") entratePrev += t.amount;
        else uscitePrev += t.amount;
      }

      const ym = ymKey(t.date);
      if (trendAcc[ym]) {
        if (t.type === "income") trendAcc[ym].entrate += t.amount;
        else trendAcc[ym].uscite += t.amount;
      }
    }

    // Totali mensili per categoria (per logica budget) — uscite per expense, entrate per income
    if (!isTransfer(t.categoryId)) {
      const ym = ymKey(t.date);
      const k = t.categoryId;
      monthlyTotals[k] ??= {};
      monthlyTotals[k][ym] = (monthlyTotals[k][ym] || 0) + t.amount;
    }

    // Movimenti recenti: prendiamo i primi 12 (già ordinati desc)
    if (recent.length < 12) {
      recent.push({
        id: t.id,
        date: t.date,
        description: t.description,
        category: cat.name,
        categoryType: cat.type as "income" | "expense",
        account: accById.get(t.bankAccountId)?.name ?? "?",
        paymentMethod: t.paymentMethodId ? pmById.get(t.paymentMethodId)?.name ?? null : null,
        amount: t.amount,
        type: t.type as "income" | "expense",
      });
    }
  }

  // ---------- KPI patrimonio ----------
  let patrimonioTotal = 0;
  let liquidity = 0;
  let savings = 0;
  for (const a of accounts) {
    const agg = accAgg.get(a.id)!;
    patrimonioTotal += agg.saldo;
    if (a.type === "savings") savings += agg.saldo;
    else if (a.type === "liquidity" || a.type === "cash") liquidity += agg.saldo;
  }

  cardsExposurePeriod = accounts
    .filter((a) => a.type === "credit_card")
    .reduce((sum, a) => sum + accAgg.get(a.id)!.saldo, 0);

  // ---------- TREND points ----------
  const fmtMonthAbbr = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return `${["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"][m - 1]} '${String(y).slice(-2)}`;
  };
  const trend: TrendPoint[] = trendKeys.map((ym) => ({
    ym,
    label: fmtMonthAbbr(ym),
    entrate: Math.round(trendAcc[ym].entrate),
    uscite: Math.round(trendAcc[ym].uscite),
    netto: Math.round(trendAcc[ym].entrate - trendAcc[ym].uscite),
  }));

  // ---------- TOP CATEGORIE (uscite del periodo) ----------
  const catEntries = Object.entries(catSpentPeriod)
    .map(([id, amt]) => ({ id, name: catById.get(id)?.name ?? "?", amount: amt }))
    .sort((a, b) => b.amount - a.amount);
  const topCategories: CategorySlice[] = [];
  const top6 = catEntries.slice(0, 6);
  const rest = catEntries.slice(6);
  for (const c of top6) {
    topCategories.push({
      name: c.name,
      amount: c.amount,
      pct: uscitePeriod > 0 ? c.amount / uscitePeriod : 0,
    });
  }
  if (rest.length > 0) {
    const altreSum = rest.reduce((s, c) => s + c.amount, 0);
    topCategories.push({
      name: `Altre (${rest.length})`,
      amount: altreSum,
      pct: uscitePeriod > 0 ? altreSum / uscitePeriod : 0,
      isOther: true,
      hidden: rest.map((r) => r.name),
    });
  }

  // ---------- ACCOUNTS rows ----------
  const accountRows: AccountRow[] = accounts.map((a) => {
    const ap = accAggPeriod.get(a.id)!;
    const ag = accAgg.get(a.id)!;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      notes: a.notes,
      initialBalance: a.initialBalance,
      entrate: ap.entrate,
      uscite: ap.uscite,
      saldo: ag.saldo,
      movs: ag.movs,
    };
  });

  // ---------- BUDGET ROWS ----------
  // Per il range multi-mese, somma di:
  //  - spesa effettiva = somma transazioni del range per categoria
  //  - budget = somma del budget di OGNI mese del range (override se presente, altrimenti auto)
  const budgetRows: BudgetRow[] = [];
  for (const c of categories) {
    if (!c.hasBudget) continue;
    const totals = monthlyTotals[c.id] ?? {};
    const catOverrides = overrideByCatMonth.get(c.id) ?? new Map<string, number>();

    let spent = 0;
    let budget = 0;
    for (const ym of periodMonths) {
      spent += totals[ym] ?? 0;
      const ov = catOverrides.get(ym);
      if (ov !== undefined) {
        budget += ov;
      } else {
        budget += computeBudgetForRow(
          c.budgetMode as any,
          ym,
          totals,
          c.manualBudget,
        );
      }
    }
    if (c.type === "expense" && budget === 0 && spent === 0) continue;
    if (c.type === "income" && budget === 0 && spent === 0) continue;
    const pct = budget > 0 ? spent / budget : spent > 0 ? 1.5 : 0;
    let status: "ok" | "warn" | "err";
    if (c.type === "expense") {
      // uscite: pi  speso = peggio
      if (pct < 0.8) status = "ok";
      else if (pct < 1.0) status = "warn";
      else status = "err";
    } else {
      // entrate: pi  vicino al target = meglio (logica invertita)
      if (pct >= 0.95) status = "ok";
      else if (pct >= 0.7) status = "warn";
      else status = "err";
    }
    budgetRows.push({
      categoryId: c.id,
      categoryName: c.name,
      type: c.type as any,
      budgetMode: c.budgetMode,
      hasBudget: c.hasBudget,
      budget,
      spent,
      pct,
      status,
    });
  }
  // Ordino per impatto: prima i fuori budget, poi per spesa decrescente
  budgetRows.sort((a, b) => {
    const sa = a.status === "err" ? 0 : a.status === "warn" ? 1 : 2;
    const sb = b.status === "err" ? 0 : b.status === "warn" ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return b.spent - a.spent;
  });

  // ---------- KPI deltas ----------
  const deltaEntrate = entratePrev > 0 ? ((entratePeriod - entratePrev) / entratePrev) * 100 : 0;
  const deltaUscite = uscitePrev > 0 ? ((uscitePeriod - uscitePrev) / uscitePrev) * 100 : 0;

  return {
    period,
    periodFrom: pFromYm,
    periodTo: pToYm,
    monthCount: periodMonthsCount,
    prevPeriod,
    hasAnyData: allTx.length > 0,
    kpi: {
      patrimonioTotal,
      liquidity,
      savings,
      cardsExposure: cardsExposurePeriod,
      entratePeriod,
      uscitePeriod,
      netto: entratePeriod - uscitePeriod,
      excludedBalancePeriod,
      movimentiTotal: allTx.length,
      movimentiPeriod,
      daVerificare,
      deltaEntrate,
      deltaUscite,
    },
    accounts: accountRows,
    trend,
    topCategories,
    budgetRows,
    recent,
  };
}

/** Versione locale del calcolo budget — clone di lib/budget.ts per evitare round-trip DB. */
function computeBudgetForRow(
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
