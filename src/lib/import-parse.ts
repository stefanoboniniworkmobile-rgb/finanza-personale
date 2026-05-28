// Parser CSV / XLSX e conversioni di tipo per l'import di movimenti.

import * as XLSX from "xlsx";

export type ParsedRow = {
  rowIndex: number; // 1-based all'interno del file (escludendo l'header)
  data: Record<string, unknown>; // colonne per nome di header (case-insensitive: chiave normalizzata)
  rawCells: unknown[]; // valori grezzi nell'ordine originale
};

export type ParsedFile = {
  headers: string[]; // intestazioni così come trovate (preservano case originale)
  headersNorm: string[]; // intestazioni normalizzate (trim+lower) per lookup
  rows: ParsedRow[];
  warnings: string[];
};

export function normalizeHeader(h: string): string {
  // Tollerante:
  //  - lowercase + trim
  //  - rimuove punteggiatura trailing (es. "Descrizione:" -> "descrizione")
  //  - collassa spazi multipli
  let s = (h ?? "").toString().trim().toLowerCase();
  s = s.replace(/\s+/g, " ");
  s = s.replace(/[\s:;,.]+$/g, "");
  return s;
}

/**
 * Parser CSV minimale ma rispettoso delle virgolette doppie.
 *  - Supporta delimiter "," ";" "\t"
 *  - Supporta valori tra virgolette doppie con escape `""`
 *  - Salta righe vuote
 */
export function parseCsv(
  text: string,
  opts: { delimiter?: string; headerRow?: number } = {},
): ParsedFile {
  const delim = opts.delimiter ?? ",";
  const headerRow = Math.max(1, opts.headerRow ?? 1);
  const warnings: string[] = [];

  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      buf += c;
      inQuotes = !inQuotes;
    } else if (c === "\n" && !inQuotes) {
      lines.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) lines.push(buf);

  const splitLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (c === delim && !q) {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells.map((s) => s.trim());
  };

  if (lines.length < headerRow) {
    return { headers: [], headersNorm: [], rows: [], warnings: ["File vuoto o senza intestazione"] };
  }

  const headerLine = lines[headerRow - 1];
  const headers = splitLine(headerLine);
  const headersNorm = headers.map(normalizeHeader);

  const rows: ParsedRow[] = [];
  let rowIdx = 0;
  for (let i = headerRow; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;
    const cells = splitLine(line);
    rowIdx++;
    const data: Record<string, unknown> = {};
    headersNorm.forEach((h, idx) => {
      data[h] = (cells[idx] ?? "").trim();
    });
    rows.push({ rowIndex: rowIdx, data, rawCells: cells });
  }

  return { headers, headersNorm, rows, warnings };
}

/**
 * Parser XLSX/XLS basato su SheetJS.
 *  - sheetName opzionale; default = primo foglio.
 *  - headerRow 1-based.
 *  - Leggiamo in modalità "raw": i numeri restano number, le date restano Date, le stringhe restano string.
 *    Il parsing tipato dei valori (importo, data) avviene a valle, evitando la roundtrippizzazione
 *    string→numero che incasinerebbe i decimali nei formati valuta come `€ ###,##0.00`.
 */
export function parseXlsx(
  buffer: ArrayBuffer | Buffer,
  opts: { sheetName?: string; headerRow?: number } = {},
): ParsedFile {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = opts.sheetName && wb.SheetNames.includes(opts.sheetName)
    ? opts.sheetName
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return { headers: [], headersNorm: [], rows: [], warnings: [`Foglio non trovato: ${opts.sheetName ?? "(primo)"}`] };
  }

  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  const headerRow = Math.max(1, opts.headerRow ?? 1);
  if (matrix.length < headerRow) {
    return { headers: [], headersNorm: [], rows: [], warnings: ["File senza intestazione"] };
  }

  const headers = (matrix[headerRow - 1] ?? []).map((c) => (c ?? "").toString());
  const headersNorm = headers.map(normalizeHeader);

  const rows: ParsedRow[] = [];
  let rowIdx = 0;
  for (let i = headerRow; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;
    rowIdx++;
    const data: Record<string, unknown> = {};
    headersNorm.forEach((h, idx) => {
      const v = row[idx];
      data[h] = typeof v === "string" ? v.trim() : (v ?? "");
    });
    rows.push({ rowIndex: rowIdx, data, rawCells: [...row] });
  }

  return { headers, headersNorm, rows, warnings: [] };
}

// ---------- Conversioni numerica / data ----------

/**
 * Parsea un importo da un valore di cella. Accetta:
 *   - number       (XLSX raw): restituito direttamente
 *   - Date         non applicabile, ritorna NaN
 *   - string       (CSV o XLSX formattato): applica i separatori del template
 *   - null/undef   ritorna NaN
 *
 * Per le stringhe rimuove € $ £ ¥ e spazi (anche \xa0 nbsp), gestisce parentesi negative,
 * separatore di migliaia configurabile e separatore decimale italiano per default.
 */
export function parseAmount(
  raw: unknown,
  decimalSep: string,
  thousandsSep: string,
): number {
  if (raw == null) return NaN;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (raw instanceof Date) return NaN;
  let s = raw.toString().trim();
  if (s === "") return NaN;

  // Parentesi = negativo (convenzione contabile)
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Rimuove simboli di valuta e spazi (incluso non-breaking space \xa0)
  s = s.replace(/[€$£¥]/g, "").replace(/\s| /g, "");

  // Rimuove migliaia
  if (thousandsSep) {
    const safe = thousandsSep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(safe, "g"), "");
  }
  // Sostituisce decimal sep con "."
  if (decimalSep && decimalSep !== ".") {
    s = s.replace(decimalSep, ".");
  }

  // Gestione segno
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

/**
 * Parsea una data. Accetta:
 *   - Date         restituita direttamente (UTC-normalizzata)
 *   - number       (XLSX raw serial) convertita
 *   - string       applica il formato del template (DD/MM/YYYY, ISO, ecc.)
 *   - null/undef   null
 */
export function parseDate(raw: unknown, format: string): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  }
  if (typeof raw === "number") {
    // Excel serial
    if (raw > 20000 && raw < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + Math.round(raw) * 86400000);
    }
    return null;
  }
  const s = raw.toString().trim();
  if (s === "") return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + Math.round(n) * 86400000);
    }
  }

  const tryIso = (str: string): Date | null => {
    const m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, mo - 1, d));
  };

  const tryDmy = (str: string): Date | null => {
    const m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) return null;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, mo - 1, d));
  };

  const tryMdy = (str: string): Date | null => {
    const m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) return null;
    const mo = Number(m[1]);
    const d = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, mo - 1, d));
  };

  switch (format) {
    case "YYYY-MM-DD":
      return tryIso(s);
    case "DD/MM/YYYY":
    case "DD-MM-YYYY":
      return tryDmy(s);
    case "MM/DD/YYYY":
      return tryMdy(s);
    case "AUTO":
    default:
      return tryIso(s) ?? tryDmy(s);
  }
}
