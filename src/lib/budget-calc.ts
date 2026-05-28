/**
 * Calcolo budget puro (no DB, no I/O). Importabile sia da client che da server.
 * Logica condivisa con `lib/budget.ts → computeBudget` ma senza dipendenze di Prisma.
 */

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
export type BudgetModeId = (typeof BUDGET_MODES)[number];

export const BUDGET_MODE_LABEL: Record<BudgetModeId, string> = {
  AVG_3M: "Media 3M",
  AVG_6M: "Media 6M",
  AVG_12M: "Media 12M",
  PREV_MONTH: "Mese prec.",
  SAME_MONTH_LY: "Stesso mese a.p.",
  MAX_3M: "Max 3M",
  ACTUAL_MONTH: "Consuntivo",
  MANUAL: "Manuale",
};

function shiftMonth(yyyymm: string, back: number): string {
  let [y, m] = yyyymm.split("-").map(Number);
  m -= back;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function computeBudgetPure(
  mode: string,
  period: string,
  monthlyTotals: Record<string, number>,
  manualAmount: number | null,
): number {
  if (mode === "MANUAL") return manualAmount ?? 0;
  // Esatto, no arrotondamento
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
