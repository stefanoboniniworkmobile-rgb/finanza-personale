/**
 * Logica di calcolo del budget per categoria.
 * Replica il comportamento del mockup HTML.
 */
import { prisma } from "@/lib/db";

export const BUDGET_MODES = [
  "AVG_3M",
  "AVG_6M",
  "AVG_12M",
  "PREV_MONTH",
  "SAME_MONTH_LY",
  "MAX_3M",
  "ACTUAL_MONTH",
  "MANUAL",
] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

export const NO_BUDGET_DEFAULT = new Set([
  "Stipendio",
  "Compenso Amministratore",
  "Interessi",
  "Rimborsi",
  "Cashback",
  "Altri ricavi",
  "Trasferimento +",
  "Trasferimento -",
  "Spese e bolli",
  "Condominio",
  "Vigilanza",
  "Assicurazioni",
  "Utenze",
  "Telefonia",
  "Spese per altri",
  "Spese Mamma",
]);

/** Restituisce "YYYY-MM" del periodo dato spostato indietro di N mesi */
function shiftMonth(yyyymm: string, back: number): string {
  let [y, m] = yyyymm.split("-").map(Number);
  m -= back;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Calcola il tetto budget per una categoria nel periodo, in base alla modalità scelta.
 * `monthlyTotals` mappa "YYYY-MM" → importo totale per quella categoria/utente.
 * Restituisce sempre un valore arrotondato ai 10€ superiori (eccetto MANUAL).
 */
export function computeBudget(
  mode: BudgetMode,
  period: string, // "YYYY-MM"
  monthlyTotals: Record<string, number>,
  manualAmount: number | null,
): number {
  if (mode === "MANUAL") return manualAmount ?? 0;
  // Consuntivo del mese stesso: importo esatto, nessun arrotondamento
  if (mode === "ACTUAL_MONTH") return monthlyTotals[period] || 0;

  const lastN = (n: number) =>
    Array.from({ length: n }, (_, i) => shiftMonth(period, i + 1));
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
      raw = monthlyTotals[shiftMonth(period, 1)] || 0;
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

/** Carica i totali mensili per ogni categoria di un intestatario in una sola query. */
export async function loadMonthlyTotals(holderId: string) {
  // Aggrego via SQL: GROUP BY categoryId, year-month
  // Usiamo $queryRaw per portabilità Postgres/SQLite
  const rows = await prisma.transaction.findMany({
    where: { holderId },
    select: { categoryId: true, date: true, amount: true },
  });
  const byCat: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const ym = r.date.toISOString().slice(0, 7);
    byCat[r.categoryId] ??= {};
    byCat[r.categoryId][ym] = (byCat[r.categoryId][ym] || 0) + r.amount;
  }
  return byCat;
}
