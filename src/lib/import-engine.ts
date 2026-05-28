// Engine puro per la categorizzazione delle righe di un import.
// Input: ParsedFile + template + mapping esistenti + entità app (conti/cat/pm).
// Output: array di ProcessedRow con status (pronto / duplicato / lookup mancante / errore).
//
// Non tocca DB. Lavora solo su dati in memoria.

import type { ParsedFile, ParsedRow } from "./import-parse";
import { parseAmount, parseDate, normalizeHeader } from "./import-parse";
import { computeTransactionHash, computeTransactionWeakKey } from "./import-hash";
import { matchPattern, type MatchType } from "./import-pattern";

export type RowStatus =
  | "ready"
  | "duplicate"
  | "possible_duplicate" // stessa data+importo di un movimento in DB, descrizione diversa
  | "needs_mapping"
  | "error";

export type ProcessedRow = {
  rowIndex: number;
  // Valori parsati
  date: string | null;          // ISO YYYY-MM-DD oppure null
  description: string;
  amount: number | null;        // valore assoluto
  type: "income" | "expense" | null;
  notes: string | null;

  // Valori sorgente per le entità (testo grezzo dal file, "" se non c'è colonna)
  sourceAccount: string;
  sourceCategory: string;
  sourcePayment: string;

  // ID risolti (via mapping o default). Null se mancante.
  bankAccountId: string | null;
  categoryId: string | null;
  paymentMethodId: string | null;

  // Riepilogo origine della risoluzione (per UI)
  resolvedFrom: {
    account: "mapping" | "default" | "none";
    category: "mapping" | "default" | "none" | "ambiguous";
    payment: "mapping" | "default" | "none";
  };

  // Se più pattern matchano la stessa descrizione con target diversi, lista i candidati.
  // L'UI mostra un selettore esplicito su queste righe.
  categoryCandidates: { categoryId: string; matchedPattern: string }[];

  hash: string | null;
  status: RowStatus;
  errors: string[];   // motivi se status != ready
};

export type EngineTemplate = {
  decimalSep: string;
  thousandsSep: string;
  dateFormat: string;
  signMode: "SIGNED" | "DEBIT_CREDIT" | "AMOUNT_PLUS_TYPE";
  colDate: string;
  colDescription: string;
  colAmount?: string | null;
  colDebit?: string | null;
  colCredit?: string | null;
  colType?: string | null;
  typeIncomeValue?: string | null;
  typeExpenseValue?: string | null;
  colAccount?: string | null;
  colCategory?: string | null;
  colPaymentMethod?: string | null;
  colNotes?: string | null;
  defaultBankAccountId?: string | null;
  defaultCategoryExpenseId?: string | null;
  defaultCategoryIncomeId?: string | null;
  defaultPaymentMethodId?: string | null;
  forceAbs: boolean;
  // Se true, dopo aver calcolato il segno con la logica di signMode, il segno finale viene
  // invertito. Utile per file dove le uscite sono positive e le entrate negative.
  invertSigns?: boolean;
  // Salta qualunque riga in cui almeno una cella contiene questa sottostringa (case-insensitive).
  // Tipico: "Totale" per scartare la riga di totale in fondo all'estratto.
  skipRowsContaining?: string | null;
};

export type EngineMapping = {
  kind: "ACCOUNT" | "CATEGORY" | "PAYMENT_METHOD";
  matchType: MatchType;
  sourceValueNorm: string;   // pattern normalizzato (per EXACT)
  sourceValueRaw: string;    // pattern grezzo (per CONTAINS/STARTS_WITH/REGEX)
  targetId: string;
};

/** Normalizza un valore sorgente per il lookup (case/spazi insensitive). */
export function normalizeSource(v: string): string {
  return (v ?? "").toString().trim().toLowerCase();
}

/** Restituisce il valore "raw" della colonna `colName`, può essere stringa/numero/Date/null. */
function getCell(row: ParsedRow, colName: string | null | undefined): unknown {
  if (!colName) return "";
  const key = normalizeHeader(colName);
  return row.data[key] ?? "";
}

/** Restituisce il valore della colonna `colName` forzato a stringa trim-ata. */
function getCellStr(row: ParsedRow, colName: string | null | undefined): string {
  const v = getCell(row, colName);
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** True se almeno una cella della riga contiene `needle` (case-insensitive). */
function rowContains(row: ParsedRow, needle: string): boolean {
  const n = needle.toLowerCase();
  for (const v of Object.values(row.data)) {
    if (v == null) continue;
    const s = typeof v === "string" ? v : String(v);
    if (s.toLowerCase().includes(n)) return true;
  }
  return false;
}

export function processRows(
  parsed: ParsedFile,
  template: EngineTemplate,
  mappings: EngineMapping[],
  existingHashes: Set<string>,
  existingWeakKeys: Set<string> = new Set(),
): ProcessedRow[] {
  // Costruisci lookup:
  //   - Per ACCOUNT/PAYMENT_METHOD usiamo SEMPRE EXACT su sourceValueNorm
  //   - Per CATEGORY:
  //       - EXACT → match su sourceCategory (lookup map)
  //       - CONTAINS/STARTS_WITH/REGEX → match su descrizione (lista pattern)
  const mapAccount = new Map<string, string>();
  const mapPayment = new Map<string, string>();
  const catExact = new Map<string, string>();
  const catPatterns: EngineMapping[] = [];
  for (const m of mappings) {
    if (m.kind === "ACCOUNT") {
      mapAccount.set(m.sourceValueNorm, m.targetId);
    } else if (m.kind === "PAYMENT_METHOD") {
      mapPayment.set(m.sourceValueNorm, m.targetId);
    } else if (m.kind === "CATEGORY") {
      if (m.matchType === "EXACT") catExact.set(m.sourceValueNorm, m.targetId);
      else catPatterns.push(m);
    }
  }
  // Ordina i pattern per lunghezza decrescente: i pattern più specifici vengono valutati prima,
  // utile per le regole di tie-break implicito quando i risultati coincidono (anche se il match
  // produce sempre la lista completa per il check di ambiguità).
  catPatterns.sort((a, b) => b.sourceValueRaw.length - a.sourceValueRaw.length);

  // Set di hash visti in questo file (per scartare duplicati interni allo stesso CSV)
  const seenInFile = new Set<string>();

  const skipNeedle = (template.skipRowsContaining ?? "").trim();

  // Filtra in anticipo le righe che corrispondono al pattern di skip (es. "Totale").
  const inputRows = skipNeedle
    ? parsed.rows.filter((r) => !rowContains(r, skipNeedle))
    : parsed.rows;

  return inputRows.map((row) => {
    const errors: string[] = [];

    // --- Descrizione ---
    const description = getCellStr(row, template.colDescription);
    if (!description) errors.push("Descrizione vuota");

    // --- Data ---
    const rawDate = getCell(row, template.colDate);
    const dt = parseDate(rawDate, template.dateFormat);
    const dateIso = dt ? dt.toISOString().slice(0, 10) : null;
    if (!dt) errors.push(`Data non riconosciuta: "${getCellStr(row, template.colDate)}"`);

    // --- Importo + segno ---
    let amountSigned: number | null = null;
    if (template.signMode === "SIGNED") {
      const raw = getCell(row, template.colAmount ?? null);
      const n = parseAmount(raw, template.decimalSep, template.thousandsSep);
      if (!Number.isFinite(n)) errors.push(`Importo non numerico: "${getCellStr(row, template.colAmount ?? null)}"`);
      else amountSigned = n;
    } else if (template.signMode === "DEBIT_CREDIT") {
      const debRaw = getCell(row, template.colDebit ?? null);
      const credRaw = getCell(row, template.colCredit ?? null);
      const deb = parseAmount(debRaw, template.decimalSep, template.thousandsSep);
      const cred = parseAmount(credRaw, template.decimalSep, template.thousandsSep);
      const debOk = Number.isFinite(deb) && deb !== 0;
      const credOk = Number.isFinite(cred) && cred !== 0;
      if (debOk && !credOk) {
        amountSigned = -Math.abs(template.forceAbs ? Math.abs(deb) : deb);
      } else if (credOk && !debOk) {
        amountSigned = Math.abs(template.forceAbs ? Math.abs(cred) : cred);
      } else if (debOk && credOk) {
        errors.push("Sia Dare che Avere valorizzati: la riga è ambigua");
      } else {
        errors.push("Importo mancante (Dare/Avere vuoti)");
      }
    } else if (template.signMode === "AMOUNT_PLUS_TYPE") {
      const raw = getCell(row, template.colAmount ?? null);
      const n = parseAmount(raw, template.decimalSep, template.thousandsSep);
      if (!Number.isFinite(n)) {
        errors.push(`Importo non numerico: "${getCellStr(row, template.colAmount ?? null)}"`);
      } else {
        const typeRaw = getCellStr(row, template.colType ?? null);
        const inc = (template.typeIncomeValue ?? "").trim();
        const exp = (template.typeExpenseValue ?? "").trim();
        const isInc = inc && typeRaw.toLowerCase() === inc.toLowerCase();
        const isExp = exp && typeRaw.toLowerCase() === exp.toLowerCase();
        if (isInc) amountSigned = Math.abs(n);
        else if (isExp) amountSigned = -Math.abs(n);
        else errors.push(`Tipo non riconosciuto: "${typeRaw}" (atteso "${inc}" o "${exp}")`);
      }
    }

    // Inversione globale del segno (opzionale).
    // Es. estratto bancario "uscite con +", "entrate con −" → invertendo il segno torniamo
    // alla convenzione del dominio (entrata >= 0, uscita < 0). L'inversione avviene DOPO il
    // calcolo di signMode (e dopo l'eventuale forceAbs di DEBIT_CREDIT/AMOUNT_PLUS_TYPE).
    if (template.invertSigns && amountSigned !== null && Number.isFinite(amountSigned)) {
      amountSigned = -amountSigned;
    }

    const amountAbs = amountSigned !== null ? Math.abs(amountSigned) : null;
    const txType: "income" | "expense" | null =
      amountSigned == null ? null : amountSigned >= 0 ? "income" : "expense";

    // --- Note ---
    const notesVal = template.colNotes ? getCellStr(row, template.colNotes) || null : null;

    // --- Risoluzione conti/categoria/modalità ---
    const sourceAccount = template.colAccount ? getCellStr(row, template.colAccount) : "";
    const sourceCategory = template.colCategory ? getCellStr(row, template.colCategory) : "";
    const sourcePayment = template.colPaymentMethod ? getCellStr(row, template.colPaymentMethod) : "";

    let bankAccountId: string | null = null;
    let resolvedAccount: "mapping" | "default" | "none" = "none";
    if (sourceAccount) {
      const k = normalizeSource(sourceAccount);
      const id = mapAccount.get(k);
      if (id) {
        bankAccountId = id;
        resolvedAccount = "mapping";
      }
    }
    if (!bankAccountId && template.defaultBankAccountId) {
      bankAccountId = template.defaultBankAccountId;
      resolvedAccount = "default";
    }

    let categoryId: string | null = null;
    let resolvedCategory: "mapping" | "default" | "none" | "ambiguous" = "none";
    let categoryCandidates: { categoryId: string; matchedPattern: string }[] = [];

    // 1) EXACT su colonna sorgente (se presente)
    if (sourceCategory) {
      const k = normalizeSource(sourceCategory);
      const id = catExact.get(k);
      if (id) {
        categoryId = id;
        resolvedCategory = "mapping";
      }
    }
    // 2) Pattern (CONTAINS/STARTS_WITH/REGEX) sulla descrizione
    if (!categoryId && description && catPatterns.length > 0) {
      const dedupe = new Map<string, { categoryId: string; matchedPattern: string }>();
      for (const m of catPatterns) {
        if (matchPattern(description, m.sourceValueRaw, m.matchType)) {
          if (!dedupe.has(m.targetId)) {
            dedupe.set(m.targetId, {
              categoryId: m.targetId,
              matchedPattern: m.sourceValueRaw,
            });
          }
        }
      }
      const found = [...dedupe.values()];
      if (found.length === 1) {
        categoryId = found[0].categoryId;
        resolvedCategory = "mapping";
      } else if (found.length > 1) {
        categoryCandidates = found;
        resolvedCategory = "ambiguous";
        // categoryId resta null → l'utente sceglierà
      }
    }
    // 3) Default per tipo, SOLO se non c'è ambiguità (l'ambiguità richiede scelta esplicita)
    if (!categoryId && resolvedCategory !== "ambiguous") {
      const def =
        txType === "income"
          ? template.defaultCategoryIncomeId
          : template.defaultCategoryExpenseId;
      if (def) {
        categoryId = def;
        resolvedCategory = "default";
      }
    }

    let paymentMethodId: string | null = null;
    let resolvedPayment: "mapping" | "default" | "none" = "none";
    if (sourcePayment) {
      const k = normalizeSource(sourcePayment);
      const id = mapPayment.get(k);
      if (id) {
        paymentMethodId = id;
        resolvedPayment = "mapping";
      }
    }
    if (!paymentMethodId && template.defaultPaymentMethodId) {
      paymentMethodId = template.defaultPaymentMethodId;
      resolvedPayment = "default";
    }

    // --- Hash + status ---
    let hash: string | null = null;
    let status: RowStatus = "ready";

    if (errors.length > 0 || !dt || amountAbs == null || txType == null || !description) {
      status = "error";
    } else {
      hash = computeTransactionHash({
        date: dt,
        amount: amountAbs,
        type: txType,
        description,
      });
      if (existingHashes.has(hash) || seenInFile.has(hash)) {
        status = "duplicate";
      } else {
        seenInFile.add(hash);
        // Match "debole": stessa data + stesso importo. Possibile duplicato con descrizione diversa.
        const weak = computeTransactionWeakKey({
          date: dt,
          amount: amountAbs,
          type: txType,
        });
        if (existingWeakKeys.has(weak)) {
          status = "possible_duplicate";
        }
      }
    }

    if (status === "ready") {
      // Conto è sempre obbligatorio
      if (!bankAccountId) {
        status = "needs_mapping";
      }
      // Categoria è obbligatoria
      if (!categoryId) {
        status = "needs_mapping";
      }
    }

    return {
      rowIndex: row.rowIndex,
      date: dateIso,
      description,
      amount: amountAbs,
      type: txType,
      notes: notesVal,
      sourceAccount,
      sourceCategory,
      sourcePayment,
      bankAccountId,
      categoryId,
      paymentMethodId,
      resolvedFrom: {
        account: resolvedAccount,
        category: resolvedCategory,
        payment: resolvedPayment,
      },
      categoryCandidates,
      hash,
      status,
      errors,
    };
  });
}
