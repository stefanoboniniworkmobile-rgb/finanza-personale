/** Formatters numerici e di data, allineati al mockup. */

/**
 * Formatter numerico manuale in formato italiano ("." migliaia, "," decimali).
 *
 * NON usa Intl.NumberFormat di proposito: in dev con turbopack/Node senza
 * full-ICU la locale "it-IT" può degradare lato server, mentre il browser ha
 * sempre ICU completo. Risultato: hydration mismatch ("1234 €" su server,
 * "1.234 €" su client) con separatore migliaia che appariva/spariva.
 * Implementazione manuale → output identico su server e client, sempre.
 */
function formatItalianNumber(
  v: number,
  opts: { minDec?: number; maxDec?: number } = {},
): string {
  if (!Number.isFinite(v)) return "0";
  const minDec = opts.minDec ?? 0;
  const maxDec = opts.maxDec ?? 0;
  const neg = v < 0;
  const abs = Math.abs(v);
  // Arrotonda a maxDec decimali
  const fixed = abs.toFixed(maxDec);
  let [intPart, decPart = ""] = fixed.split(".");
  // Trim zeri di coda fino a minDec
  if (decPart.length > minDec) {
    decPart = decPart.replace(/0+$/, "");
    while (decPart.length < minDec) decPart += "0";
  }
  // Raggruppa interi con "." ogni 3 da destra
  let grouped = "";
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) grouped += ".";
    grouped += intPart[i];
  }
  const sign = neg ? "-" : "";
  return decPart ? `${sign}${grouped},${decPart}` : `${sign}${grouped}`;
}

const nfDate = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
});

const nfDateFull = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const nfMonth = new Intl.DateTimeFormat("it-IT", {
  month: "short",
  year: "2-digit",
});

const MONTHS_LONG = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

/** "1.234 €" senza decimali */
export const fmtEUR = (v: number) =>
  `${formatItalianNumber(v, { maxDec: 0 })} €`;

/** "1.234,56 €" con due decimali precisi */
export const fmtEURFull = (v: number) =>
  `${formatItalianNumber(v, { minDec: 2, maxDec: 2 })} €`;

/** "1.234,56" con due decimali (per importi precisi) */
export const fmtN = (v: number) => formatItalianNumber(v, { minDec: 2, maxDec: 2 });

/** "1.234" senza decimali (interi) */
export const fmtN0 = (v: number) => formatItalianNumber(v, { maxDec: 0 });

/** "12k" / "1,2M" — versione compatta per sub-label KPI */
export const fmtK = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(".", ",") + "M";
  if (abs >= 1_000) return Math.round(v / 1_000) + "k";
  return Math.round(v).toString();
};

/** "+12,3%" / "-4,5%" */
export const fmtPct = (v: number, sign = true) => {
  const s = sign && v > 0 ? "+" : "";
  return s + v.toFixed(1).replace(".", ",") + "%";
};

/** "06/05" */
export const fmtDate = (d: Date) => nfDate.format(d);

/** "06/05/2026" */
export const fmtDateFull = (d: Date) => nfDateFull.format(d);

/** "mag '26" */
export const fmtMonthShort = (d: Date) => nfMonth.format(d);

/** "Aprile 2026" da "2026-04" */
export const fmtMonthLong = (yyyymm: string) => {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
};

/** "YYYY-MM" da Date */
export const ymKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** YYYY-MM precedente di N mesi */
export const shiftYm = (yyyymm: string, back: number): string => {
  let [y, m] = yyyymm.split("-").map(Number);
  m -= back;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
};

/** Range [from,to] sotto forma di Date inclusivi del mese yyyymm */
export const monthRange = (yyyymm: string): { from: Date; to: Date } => {
  const [y, m] = yyyymm.split("-").map(Number);
  return {
    from: new Date(y, m - 1, 1),
    to: new Date(y, m, 1), // esclusivo
  };
};

/**
 * Parse di un "period" che può essere:
 *  - "YYYY-MM" → singolo mese (from = to = period)
 *  - "YYYY-MM..YYYY-MM" → range inclusivo
 *
 * Il range è sempre normalizzato con from <= to.
 */
export const parsePeriod = (period: string): { from: string; to: string } => {
  if (period.includes("..")) {
    const [a, b] = period.split("..");
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  return { from: period, to: period };
};

/** Lista di "YYYY-MM" dal mese from al mese to inclusivi (cronologico). */
export const monthsBetween = (from: string, to: string): string[] => {
  if (from > to) return monthsBetween(to, from);
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    // shiftYm avanza all'indietro, per andare avanti aggiungo manualmente
    let [y, m] = cur.split("-").map(Number);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    cur = `${y}-${String(m).padStart(2, "0")}`;
  }
  return out;
};

/** Label leggibile di un periodo range. */
export const fmtPeriodLabel = (from: string, to: string): string => {
  if (from === to) return fmtMonthLong(from);
  // Stesso anno: "Gennaio – Maggio 2026"
  const [yFrom] = from.split("-");
  const [yTo, mTo] = to.split("-");
  if (yFrom === yTo) {
    const [, mFrom] = from.split("-");
    const monthFrom = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"][Number(mFrom) - 1];
    const monthTo = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"][Number(mTo) - 1];
    return `${monthFrom} – ${monthTo} ${yTo}`;
  }
  return `${fmtMonthLong(from)} – ${fmtMonthLong(to)}`;
};

/** Range Date inclusivo coprendo da inizio mese `from` a inizio mese DOPO `to` (esclusivo). */
export const periodDateRange = (from: string, to: string): { from: Date; to: Date } => {
  const a = monthRange(from);
  const b = monthRange(to);
  return { from: a.from, to: b.to };
};

/** Numero di mesi nel range (inclusivo). */
export const monthCount = (from: string, to: string): number => {
  return monthsBetween(from, to).length;
};

/**
 * Formatta un numero per essere mostrato in un input di testo, con separatore
 * migliaia italiano ("." per migliaia) e nessun decimale di default. Per valori
 * con decimali usa "," come separatore decimale.
 * Esempi: 1234 → "1.234"; 1234.56 → "1.234,56"; 0 → "" (vuoto, per UX input).
 */
export const fmtForInput = (v: number, opts?: { keepZero?: boolean }): string => {
  if (!Number.isFinite(v)) return "";
  if (v === 0 && !opts?.keepZero) return "";
  const hasDec = !Number.isInteger(v);
  return formatItalianNumber(v, { minDec: hasDec ? 2 : 0, maxDec: 2 });
};

/**
 * Parsa una stringa numerica in formato italiano (separatore migliaia ".",
 * decimale ","). Tollera anche il formato anglosassone se chiaro dal contesto.
 * Restituisce null per stringhe vuote o non parsabili.
 */
export const parseItalianNumber = (raw: string): number | null => {
  if (!raw || !raw.trim()) return null;
  let s = raw.trim().replace(/\s/g, "").replace(/€/g, "");
  // Caso ambiguo: solo "." senza ","  → assume sia separatore migliaia se ci
  // sono più di 3 cifre dopo l'ultimo punto OPPURE due o più punti.
  // Es. "1.234" → 1234; "1.5" → 1.5
  const hasComma = s.includes(",");
  const dotCount = (s.match(/\./g) || []).length;

  if (hasComma) {
    // Italiano: rimuovi tutti i punti (migliaia) e cambia "," in "."
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1) {
    // Più di un punto: tutti migliaia
    s = s.replace(/\./g, "");
  } else if (dotCount === 1) {
    const [intPart, decPart] = s.split(".");
    if (decPart.length === 3 && intPart.length <= 3) {
      // Tipo "1.234" → 1234 (separatore migliaia)
      s = intPart + decPart;
    }
    // altrimenti tratto come decimale (anglosassone)
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
