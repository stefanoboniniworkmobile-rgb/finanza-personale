/**
 * Sync engine PSD2 — scarica transazioni via Enable Banking e le persiste nel DB.
 *
 * Strategia di sync (in ordine di precedenza):
 *  1) Range esplicito (opts.from / opts.to) → usa esattamente quelle date
 *  2) Full re-fetch (opts.full = true) → strategy="longest", ignora qualsiasi cutoff
 *  3) Incremental (default) →
 *     - se BankConnection.lastSyncedTxDate IS NOT NULL: from = lastSyncedTxDate - 7gg buffer
 *     - altrimenti (primo sync mai fatto): controlla se ci sono TX ESISTENTI in DB
 *       per quel BankAccount (tipicamente importate via Excel). Se sì, parte
 *       da max(date_esistente) + 1 giorno per NON ri-importare lo storico già presente.
 *       Se invece il BankAccount è vuoto, strategy="longest" (scarica tutto).
 *
 * Dedup primario: ogni transazione ha un `providerEntryRef` stabile.
 * - Se EB fornisce `entry_reference` o `transaction_id` lo usiamo direttamente.
 * - Altrimenti (Mediolanum & co. lasciano entrambi a null) generiamo uno SHA1
 *   deterministico dei campi raw stabili → vedi `stableRefFor()`.
 *   Questo ci dà uno ID stable cross-sync anche per banche "spartane".
 *
 * Healing: tx legacy in DB con providerEntryRef=NULL (importate da versioni
 * precedenti del sync) vengono "guarite" — se trovano un match euristico
 * (date+amount+desc) durante il sync, il providerEntryRef viene popolato.
 *
 * Fuzzy duplicate detection: per ogni tx in "insert", cerchiamo tx manuali
 * (bankConnectionId=NULL, tipicamente import Excel) nello stesso BankAccount,
 * con stesso importo, data ±5gg, descrizione con almeno un token significativo
 * in comune. Se trovate, marchiamo la PreviewTx come `suspectedDuplicate=true`
 * così l'UI può evidenziarle e l'utente decidere se importarle.
 *
 * Buffer di 7 giorni: alcune banche modificano transazioni "vecchie" per qualche
 * giorno (PDNG → BOOK con cambio di valuta), quindi rifacciamo l'ultima settimana
 * a ogni sync incrementale per assorbire questi aggiornamenti.
 */

import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  listTransactions,
  type Transaction as EbTransaction,
} from "./enable-banking";

const INCREMENTAL_BUFFER_DAYS = 7;
const PSD2_MAX_HISTORY_DAYS = 90;
const FUZZY_WINDOW_DAYS = 5;

function clampDateFromToPsd2History(dateFrom: string): string {
  const earliest = new Date();
  earliest.setDate(earliest.getDate() - PSD2_MAX_HISTORY_DAYS);
  const earliestIso = earliest.toISOString().slice(0, 10);
  return dateFrom < earliestIso ? earliestIso : dateFrom;
}

export type SyncOptions = {
  /** YYYY-MM-DD esplicito. Override su qualsiasi logica auto. */
  from?: string;
  /** YYYY-MM-DD esplicito. Default: oggi. */
  to?: string;
  /** Se true, forza strategy="longest" e ignora lastSyncedTxDate. */
  full?: boolean;
  /** Se true, fa fetch+mapping ma NON scrive in DB. Popola SyncStats.preview. */
  dryRun?: boolean;
  /** Headers PSU-* da inoltrare a Enable Banking (presenza utente). */
  psuHeaders?: Record<string, string>;
  /**
   * Se presente: solo le tx con `id` in questa lista verranno effettivamente
   * importate (insert/update). Le altre vengono saltate (l'utente le ha
   * deselezionate nel preview). Ignorato in dryRun.
   */
  selectedIds?: string[];
};

/** Una singola transazione mappata, con l'azione che il sync prenderebbe. */
export type PreviewTx = {
  /** ID stable usato dall'UI per la selezione. Coincide con `providerEntryRef`. */
  id: string;
  action: "insert" | "update" | "skip";
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  type: "income" | "expense";
  providerEntryRef: string;
  /**
   * True se è un "update healing": la tx è già in DB ma senza providerEntryRef
   * (importata da versioni precedenti del sync). Confermando l'import si
   * popola il providerEntryRef sulla tx esistente, sistemando la dedup futura.
   */
  isHealing: boolean;
  /**
   * True se è stata trovata almeno una tx manuale (bankConnectionId=NULL)
   * nel BankAccount con stesso importo, data vicina (±5gg) e descrizione simile.
   * Suggerisce che l'utente abbia già inserito manualmente la stessa transazione.
   */
  suspectedDuplicate: boolean;
  /**
   * Se suspectedDuplicate=true, il movimento esistente che ha causato il match
   * (per visualizzazione in UI con tooltip/info).
   */
  duplicateMatch: {
    id: string;
    date: string;
    amount: number;
    description: string;
  } | null;
};

export type SyncStats = {
  pagesFetched: number;
  txReceived: number;
  txInserted: number;
  txUpdated: number;
  txSkipped: number;
  /** Quante tx legacy hanno avuto il providerEntryRef "guarito" dal nuovo hash. */
  txHealed: number;
  dateRangeReceived: { min: string; max: string } | null;
  /** Nuovo valore di lastSyncedTxDate dopo il sync (se ci sono state tx). */
  newLastSyncedTxDate: Date | null;
  elapsedMs: number;
  /** Lista tx mappate con azione prevista. Popolata SEMPRE (anche in modalità write). */
  preview: PreviewTx[];
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Genera uno SHA1 deterministico da campi RAW della tx EB che NON cambiano
 * tra fetches successive. Usato come fallback quando entry_reference e
 * transaction_id sono entrambi null (es. Mediolanum).
 *
 * Campi inclusi (scelta conservativa, niente di volatile):
 *  - booking_date, value_date, transaction_date
 *  - transaction_amount (amount + currency)
 *  - credit_debit_indicator
 *  - bank_transaction_code.description (codice proprietario)
 *  - creditor.name, debtor.name (per disambiguare tx stesso giorno)
 *  - remittance_information_unstructured (per ultimi disambiguator)
 *
 * Edge case noto: 2 tx con TUTTI questi campi identici (es. 2 caffè da
 * stesso bar stesso giorno) collidono → solo una viene inserita. Accettabile
 * trade-off (sennò avremmo non-determinism cross-sync).
 */
function stableRefFor(ebTx: EbTransaction): string {
  const parts = [
    ebTx.booking_date ?? "",
    ebTx.value_date ?? "",
    ebTx.transaction_date ?? "",
    ebTx.transaction_amount?.amount ?? "",
    ebTx.transaction_amount?.currency ?? "",
    ebTx.credit_debit_indicator ?? "",
    ebTx.bank_transaction_code?.description ?? "",
    ebTx.creditor?.name ?? "",
    ebTx.debtor?.name ?? "",
    ebTx.remittance_information_unstructured ?? "",
  ];
  const h = createHash("sha1").update(parts.join("|")).digest("hex");
  return `eb-hash:${h.slice(0, 24)}`;
}

/**
 * Tokenizza una descrizione: lowercase, strip accenti/punteggiatura,
 * tiene solo token con almeno 4 caratteri.
 */
function tokenizeDesc(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accenti
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4);
  return new Set(tokens);
}

/**
 * Due descrizioni sono "simili" se condividono almeno un token significativo.
 * Se una delle due non ha token significativi (descrizioni vuote/molto corte),
 * accettiamo il match (lasciamo decidere ad amount+date).
 */
function descriptionsSimilar(a: string, b: string): boolean {
  const ta = tokenizeDesc(a);
  const tb = tokenizeDesc(b);
  if (ta.size === 0 || tb.size === 0) return true;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Mappa una transazione Enable Banking nei campi che ci servono per
 * crearla/aggiornarla in DB. Pura: nessuna I/O.
 *
 * Ritorna null se la transazione non è mappabile (manca data o importo),
 * così il chiamante può loggarla e proseguire.
 *
 * IMPORTANTE: `providerEntryRef` è SEMPRE valorizzato (mai null) — usa
 * entry_reference/transaction_id se forniti, altrimenti uno SHA1 stable.
 */
export function mapEbTransaction(tx: EbTransaction): {
  date: Date;
  description: string;
  amount: number; // sempre positivo
  type: "income" | "expense";
  providerEntryRef: string;
} | null {
  // Data: preferenza value_date (data valuta, quando i fondi sono effettivamente
  // disponibili), poi booking_date, poi transaction_date. Scelta su richiesta
  // utente: la data valuta è quella semanticamente più rilevante per il bilancio
  // (cash-flow reale) rispetto alla data contabile (booking_date) che può
  // ritardare di 1-2 giorni rispetto al momento in cui i soldi escono/entrano.
  const dateStr = tx.value_date ?? tx.booking_date ?? tx.transaction_date;
  if (!dateStr) return null;
  const date = new Date(dateStr + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime())) return null;

  // Importo: arriva come stringa, va parsato
  const amountStr = tx.transaction_amount?.amount;
  if (!amountStr) return null;
  const amountNum = Number(amountStr);
  if (!Number.isFinite(amountNum)) return null;
  const amount = Math.abs(amountNum);

  // Segno: dal credit_debit_indicator
  // CRDT = entrata (income); DBIT = uscita (expense)
  const type: "income" | "expense" =
    tx.credit_debit_indicator === "CRDT" ? "income" : "expense";

  // Descrizione: best-effort composition
  // Mediolanum mette tutto in remittance_information_unstructured (es. "DEL ... C/O ... CARTA N.")
  // Altre banche potrebbero usare remittance_information (array) o bank_transaction_code.description
  const descParts: string[] = [];
  if (tx.remittance_information_unstructured) {
    descParts.push(tx.remittance_information_unstructured);
  } else if (tx.remittance_information && tx.remittance_information.length > 0) {
    descParts.push(tx.remittance_information.join(" "));
  } else if (tx.bank_transaction_code?.description) {
    descParts.push(tx.bank_transaction_code.description);
  }
  // Se è un bonifico con creditor/debitor info esplicito, lo accodiamo
  if (tx.creditor?.name) descParts.push(`→ ${tx.creditor.name}`);
  if (tx.debtor?.name) descParts.push(`← ${tx.debtor.name}`);
  const description = descParts.join(" — ").trim() || "(senza descrizione)";

  // providerEntryRef: priorità EB-provided, fallback a hash stabile.
  const providerEntryRef =
    tx.entry_reference ?? tx.transaction_id ?? stableRefFor(tx);

  return { date, description, amount, type, providerEntryRef };
}

// ============================================================
// SYNC PRINCIPALE
// ============================================================

/**
 * Esegue il sync di una BankConnection: scarica tx via EB, le inserisce/aggiorna
 * in DB, aggiorna lastSyncAt e lastSyncedTxDate.
 */
export async function syncBankConnection(
  prisma: PrismaClient,
  bankConnectionId: string,
  opts: SyncOptions = {},
): Promise<SyncStats> {
  const t0 = Date.now();

  // Carica BankConnection + dependencies
  const conn = await prisma.bankConnection.findUnique({
    where: { id: bankConnectionId },
    include: { bankAccount: true },
  });
  if (!conn) throw new Error(`BankConnection ${bankConnectionId} non trovata`);
  if (conn.status === "expired" || conn.status === "revoked") {
    throw new Error(
      `BankConnection in stato ${conn.status} — serve rifare il consent flow`,
    );
  }

  // Risolve range date secondo precedenza (vedi commento di file):
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let strategy: "default" | "longest" = "default";

  if (opts.from || opts.to) {
    dateFrom = opts.from;
    dateTo = opts.to;
    // FIX (2026-05-26): quando l'utente specifica un from esplicito
    // (es. tramite "Da data..." nella UI per recuperare storico),
    // forziamo anche strategy="longest". Senza, EB resta in
    // strategy="default" e molte banche italiane (Mediolanum, Credem)
    // tornano solo gli ultimi ~60-90 giorni indipendentemente dal
    // dateFrom richiesto. strategy=longest istruisce EB a chiedere il
    // massimo storico disponibile, poi il dateFrom fa da filtro lato banca.
    //
    // Limite strutturale residuo: alcune banche italiane non espongono
    // storico più vecchio di 90 giorni via PSD2 indipendentemente da
    // strategy/dateFrom. In quei casi l'utente vedrà comunque solo gli
    // ultimi ~90 giorni — è una policy della banca, non aggirabile lato app.
    strategy = "longest";
  } else if (opts.full) {
    strategy = "longest";
  } else if (conn.lastSyncedTxDate) {
    const fromDate = new Date(conn.lastSyncedTxDate);
    fromDate.setDate(fromDate.getDate() - INCREMENTAL_BUFFER_DAYS);
    dateFrom = fromDate.toISOString().slice(0, 10);
  } else {
    // Primo sync mai fatto: rispetta lo storico già in DB (typically da import Excel).
    const latestExisting = await prisma.transaction.findFirst({
      where: { bankAccountId: conn.bankAccountId },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (latestExisting) {
      const fromDate = new Date(latestExisting.date);
      fromDate.setDate(fromDate.getDate() + 1);
      dateFrom = fromDate.toISOString().slice(0, 10);
    } else {
      strategy = "longest";
    }
  }

  // Clamp a "non oltre oggi". Caso tipico: il primo sync di un BankAccount
  // che ha già storico importato da Excel fino al giorno corrente — la
  // formula "ultima_tx + 1 giorno" produce una data nel futuro, che EB
  // rifiuta con 422 "date_from can not be in the future". Lo applichiamo
  // a entrambi i rami (lastSyncedTxDate e latestExisting) e anche a opts.from
  // così se qualcuno passa per sbaglio una data futura non sbattiamo il muso.
  if (dateFrom) {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (dateFrom > todayIso) {
      dateFrom = todayIso;
    }
    dateFrom = clampDateFromToPsd2History(dateFrom);
  }

  // Categoria fallback "Da categorizzare PSD2": cerca o crea (solo in write mode).
  let fallbackExpenseCategoryId: string | null = null;
  let fallbackIncomeCategoryId: string | null = null;
  if (!opts.dryRun) {
    const fallbackExpense = await prisma.category.upsert({
      where: {
        holderId_name: {
          holderId: conn.holderId,
          name: "Da categorizzare (PSD2)",
        },
      },
      update: {},
      create: {
        holderId: conn.holderId,
        name: "Da categorizzare (PSD2)",
        type: "expense",
        showInDashboard: false,
        hasBudget: false,
      },
    });
    fallbackExpenseCategoryId = fallbackExpense.id;

    const fallbackIncome = await prisma.category.upsert({
      where: {
        holderId_name: {
          holderId: conn.holderId,
          name: "Da categorizzare entrate (PSD2)",
        },
      },
      update: {},
      create: {
        holderId: conn.holderId,
        name: "Da categorizzare entrate (PSD2)",
        type: "income",
        showInDashboard: false,
        hasBudget: false,
      },
    });
    fallbackIncomeCategoryId = fallbackIncome.id;
  }

  // Fetch paginato
  const allTx: EbTransaction[] = [];
  let continuationKey: string | undefined = undefined;
  let pages = 0;
  do {
    pages++;
    const res = await listTransactions(conn.providerAccountId, {
      strategy,
      dateFrom,
      dateTo,
      continuationKey,
      psuHeaders: opts.psuHeaders,
    });
    allTx.push(...res.transactions);
    continuationKey = res.continuation_key ?? undefined;
  } while (continuationKey);

  // Pre-pass: mappa tutte le tx + calcola finestra date
  type MappedTx = {
    id: string;
    date: Date;
    description: string;
    amount: number;
    type: "income" | "expense";
    providerEntryRef: string;
  };
  const validMapped: MappedTx[] = [];
  let mapFailures = 0;
  for (const ebTx of allTx) {
    const m = mapEbTransaction(ebTx);
    if (!m) {
      mapFailures++;
      continue;
    }
    validMapped.push({
      id: m.providerEntryRef, // l'id UI coincide con providerEntryRef
      date: m.date,
      description: m.description,
      amount: m.amount,
      type: m.type,
      providerEntryRef: m.providerEntryRef,
    });
  }

  // Min/Max date dalle tx mappate
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let newLastSynced: Date | null = null;
  for (const m of validMapped) {
    const iso = m.date.toISOString().slice(0, 10);
    if (!minDate || iso < minDate) minDate = iso;
    if (!maxDate || iso > maxDate) maxDate = iso;
    if (!newLastSynced || m.date > newLastSynced) newLastSynced = m.date;
  }

  // Carica tx manuali nel range (per fuzzy duplicate detection)
  type ManualTx = {
    id: string;
    date: Date;
    amount: number;
    description: string;
  };
  let manualExisting: ManualTx[] = [];
  if (validMapped.length > 0 && minDate && maxDate) {
    const winFrom = new Date(minDate + "T00:00:00.000Z");
    winFrom.setUTCDate(winFrom.getUTCDate() - FUZZY_WINDOW_DAYS);
    const winTo = new Date(maxDate + "T00:00:00.000Z");
    winTo.setUTCDate(winTo.getUTCDate() + FUZZY_WINDOW_DAYS);
    manualExisting = await prisma.transaction.findMany({
      where: {
        bankAccountId: conn.bankAccountId,
        bankConnectionId: null,
        date: { gte: winFrom, lte: winTo },
      },
      select: { id: true, date: true, amount: true, description: true },
    });
  }

  const selectedIdsSet = opts.selectedIds ? new Set(opts.selectedIds) : null;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let healed = 0;
  const preview: PreviewTx[] = [];

  for (const mapped of validMapped) {
    const isoDate = mapped.date.toISOString().slice(0, 10);

    let action: PreviewTx["action"];
    let existingTxId: string | null = null;
    let needsHealing = false;

    // Step 1: dedup primario per providerEntryRef
    const existingByRef = await prisma.transaction.findFirst({
      where: {
        bankConnectionId: conn.id,
        providerEntryRef: mapped.providerEntryRef,
      },
      select: { id: true },
    });
    if (existingByRef) {
      action = "update";
      existingTxId = existingByRef.id;
    } else {
      // Step 2: healing per tx legacy (providerEntryRef=NULL in DB).
      // Le tx importate da versioni precedenti del sync possono:
      //  a) avere providerEntryRef NULL (perché EB non lo dava — Mediolanum)
      //  b) avere `date` = booking_date mentre ora usiamo value_date
      //  c) avere descrizione lievemente diversa (Mediolanum varia spazi/casing
      //     o aggiunge/toglie suffix → creditor/← debtor tra chiamate)
      //
      // Strategia: cerco candidati con amount exact + date in ±5gg, poi
      // applico filtri progressivi: exact desc → fuzzy similar → unico
      // candidato (fallback ultimo per amount-only match dentro la window).
      const healingFrom = new Date(mapped.date);
      healingFrom.setUTCDate(healingFrom.getUTCDate() - 5);
      const healingTo = new Date(mapped.date);
      healingTo.setUTCDate(healingTo.getUTCDate() + 5);
      const candidates = await prisma.transaction.findMany({
        where: {
          bankConnectionId: conn.id,
          providerEntryRef: null,
          date: { gte: healingFrom, lte: healingTo },
          amount: mapped.amount,
        },
        select: { id: true, date: true, description: true },
      });
      let legacy: { id: string } | null = null;
      // a) exact description match
      for (const c of candidates) {
        if (c.description === mapped.description) {
          legacy = { id: c.id };
          break;
        }
      }
      // b) fuzzy: condividono almeno un token significativo
      if (!legacy) {
        for (const c of candidates) {
          if (descriptionsSimilar(c.description, mapped.description)) {
            legacy = { id: c.id };
            break;
          }
        }
      }
      // c) fallback aggressivo: un solo candidato con amount+date match
      //    in tutta la window → quasi certamente è la stessa tx, healing
      if (!legacy && candidates.length === 1) {
        legacy = { id: candidates[0].id };
      }
      if (legacy) {
        action = "update";
        existingTxId = legacy.id;
        needsHealing = true;
      } else {
        action = "insert";
      }
    }

    // Step 3: fuzzy duplicate detection (solo per insert)
    let suspectedDuplicate = false;
    let duplicateMatch: PreviewTx["duplicateMatch"] = null;
    if (action === "insert" && manualExisting.length > 0) {
      let best: ManualTx | null = null;
      for (const ex of manualExisting) {
        if (Math.abs(ex.amount - mapped.amount) > 0.01) continue;
        const d = daysBetween(ex.date, mapped.date);
        if (d > FUZZY_WINDOW_DAYS) continue;
        if (!descriptionsSimilar(ex.description, mapped.description)) continue;
        if (
          !best ||
          daysBetween(ex.date, mapped.date) <
            daysBetween(best.date, mapped.date)
        ) {
          best = ex;
        }
      }
      if (best) {
        suspectedDuplicate = true;
        duplicateMatch = {
          id: best.id,
          date: best.date.toISOString().slice(0, 10),
          amount: best.amount,
          description: best.description,
        };
      }
    }

    preview.push({
      id: mapped.id,
      action,
      date: isoDate,
      description: mapped.description,
      amount: mapped.amount,
      type: mapped.type,
      providerEntryRef: mapped.providerEntryRef,
      isHealing: needsHealing,
      suspectedDuplicate,
      duplicateMatch,
    });

    // Dry-run: solo conteggi, niente scritture
    if (opts.dryRun) {
      if (action === "insert") inserted++;
      else if (action === "update") updated++;
      else skipped++;
      continue;
    }

    // Write mode: se l'utente ha fornito selectedIds, salta le tx non selezionate
    if (selectedIdsSet && !selectedIdsSet.has(mapped.id)) {
      skipped++;
      continue;
    }

    // Esegui azione
    const categoryId =
      mapped.type === "income"
        ? fallbackIncomeCategoryId!
        : fallbackExpenseCategoryId!;

    if (action === "update" && existingTxId) {
      await prisma.transaction.update({
        where: { id: existingTxId },
        data: {
          date: mapped.date,
          description: mapped.description,
          amount: mapped.amount,
          type: mapped.type,
          // Healing: popola providerEntryRef sulla tx legacy
          ...(needsHealing ? { providerEntryRef: mapped.providerEntryRef } : {}),
          // categoryId NON sovrascritta: rispettiamo l'eventuale categorizzazione manuale
        },
      });
      updated++;
      if (needsHealing) healed++;
    } else if (action === "insert") {
      await prisma.transaction.create({
        data: {
          holderId: conn.holderId,
          bankAccountId: conn.bankAccountId,
          categoryId,
          date: mapped.date,
          description: mapped.description,
          amount: mapped.amount,
          type: mapped.type,
          bankConnectionId: conn.id,
          providerEntryRef: mapped.providerEntryRef,
        },
      });
      inserted++;
    } else {
      skipped++;
    }
  }

  // Aggiorna metadati BankConnection (solo in write mode)
  if (!opts.dryRun) {
    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncAt: new Date(),
        ...(newLastSynced ? { lastSyncedTxDate: newLastSynced } : {}),
        errorMessage: null,
        status: conn.status === "error" ? "active" : conn.status,
      },
    });
  }

  return {
    pagesFetched: pages,
    txReceived: allTx.length,
    txInserted: inserted,
    txUpdated: updated,
    txSkipped: skipped + mapFailures,
    txHealed: healed,
    dateRangeReceived: minDate && maxDate ? { min: minDate, max: maxDate } : null,
    newLastSyncedTxDate: newLastSynced,
    elapsedMs: Date.now() - t0,
    preview,
  };
}
