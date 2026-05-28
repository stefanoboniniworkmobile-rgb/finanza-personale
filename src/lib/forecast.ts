/** Helper puri per la feature forecast (importabili sia client che server). */

export function parseActualMonths(csv: string): number[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
}

export function csvFromMonthArr(arr: number[]): string {
  return Array.from(new Set(arr.filter((m) => m >= 1 && m <= 12)))
    .sort((a, b) => a - b)
    .join(",");
}
