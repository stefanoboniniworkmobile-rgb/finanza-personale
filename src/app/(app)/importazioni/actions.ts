"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseCsv, parseXlsx } from "@/lib/import-parse";
import { processRows, type EngineMapping, type EngineTemplate, type ProcessedRow } from "@/lib/import-engine";
import { computeTransactionHash, computeTransactionWeakKey } from "@/lib/import-hash";

// ============== Tipi result ==============

export type ActionResult<T = {}> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

async function requireHolder() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

// ============== Template ==============

const SIGN_MODES = ["SIGNED", "DEBIT_CREDIT", "AMOUNT_PLUS_TYPE"] as const;
const FILE_TYPES = ["csv", "xlsx"] as const;
const DATE_FORMATS = [
  "DD/MM/YYYY",
  "DD-MM-YYYY",
  "YYYY-MM-DD",
  "MM/DD/YYYY",
  "AUTO",
] as const;

const templateInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Nome obbligatorio").max(80),
  sourceLabel: z.string().trim().max(200).nullable().optional(),
  fileType: z.enum(FILE_TYPES).default("csv"),

  sheetName: z.string().trim().max(80).nullable().optional(),
  headerRow: z.coerce.number().int().min(1).max(50).default(1),
  delimiter: z.string().min(1).max(3).default(","),
  encoding: z.string().min(1).max(20).default("utf-8"),
  decimalSep: z.string().min(1).max(1),
  thousandsSep: z.string().max(1),
  dateFormat: z.enum(DATE_FORMATS).default("DD/MM/YYYY"),

  signMode: z.enum(SIGN_MODES).default("SIGNED"),

  colDate: z.string().trim().min(1, "Colonna data obbligatoria").max(80),
  colDescription: z.string().trim().min(1, "Colonna descrizione obbligatoria").max(80),
  colAmount: z.string().trim().max(80).nullable().optional(),
  colDebit: z.string().trim().max(80).nullable().optional(),
  colCredit: z.string().trim().max(80).nullable().optional(),
  colType: z.string().trim().max(80).nullable().optional(),
  typeIncomeValue: z.string().trim().max(40).nullable().optional(),
  typeExpenseValue: z.string().trim().max(40).nullable().optional(),

  colAccount: z.string().trim().max(80).nullable().optional(),
  colCategory: z.string().trim().max(80).nullable().optional(),
  colPaymentMethod: z.string().trim().max(80).nullable().optional(),
  colNotes: z.string().trim().max(80).nullable().optional(),

  defaultBankAccountId: z.string().nullable().optional(),
  defaultCategoryExpenseId: z.string().nullable().optional(),
  defaultCategoryIncomeId: z.string().nullable().optional(),
  defaultPaymentMethodId: z.string().nullable().optional(),

  forceAbs: z.coerce.boolean().default(true),
  invertSigns: z.coerce.boolean().default(false),
  skipRowsContaining: z.string().trim().max(80).nullable().optional(),
});

export type TemplateInput = z.infer<typeof templateInputSchema>;

function validateSignModeFields(v: TemplateInput): string | null {
  if (v.signMode === "SIGNED" && !v.colAmount) {
    return "Per la modalità 'Una colonna con segno' devi indicare la colonna Importo";
  }
  if (v.signMode === "DEBIT_CREDIT" && (!v.colDebit || !v.colCredit)) {
    return "Per la modalità 'Dare/Avere' devi indicare entrambe le colonne";
  }
  if (
    v.signMode === "AMOUNT_PLUS_TYPE" &&
    (!v.colAmount || !v.colType || !v.typeIncomeValue || !v.typeExpenseValue)
  ) {
    return "Per la modalità 'Importo + tipo' devi indicare colonna importo, colonna tipo e i valori per entrata/uscita";
  }
  return null;
}

async function ensureOwnedEntities(
  holderId: string,
  ids: { bankAccountId?: string | null; categoryIds?: (string | null | undefined)[]; paymentMethodId?: string | null },
): Promise<string | null> {
  if (ids.bankAccountId) {
    const ok = await prisma.bankAccount.findFirst({
      where: { id: ids.bankAccountId, holderId },
      select: { id: true },
    });
    if (!ok) return "Conto di default non valido";
  }
  for (const cId of ids.categoryIds ?? []) {
    if (!cId) continue;
    const ok = await prisma.category.findFirst({
      where: { id: cId, holderId },
      select: { id: true },
    });
    if (!ok) return "Categoria di default non valida";
  }
  if (ids.paymentMethodId) {
    const ok = await prisma.paymentMethod.findFirst({
      where: { id: ids.paymentMethodId, holderId },
      select: { id: true },
    });
    if (!ok) return "Modalità di pagamento di default non valida";
  }
  return null;
}

export async function saveTemplate(raw: TemplateInput): Promise<ActionResult<{ id: string }>> {
  const { holderId } = await requireHolder();
  const parse = templateInputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;
  const modeErr = validateSignModeFields(v);
  if (modeErr) return { ok: false, error: modeErr };
  const ownErr = await ensureOwnedEntities(holderId, {
    bankAccountId: v.defaultBankAccountId,
    categoryIds: [v.defaultCategoryExpenseId, v.defaultCategoryIncomeId],
    paymentMethodId: v.defaultPaymentMethodId,
  });
  if (ownErr) return { ok: false, error: ownErr };

  // Campi scalari "puri" (no FK con relation typed)
  const scalarData = {
    name: v.name,
    sourceLabel: v.sourceLabel || null,
    fileType: v.fileType,
    sheetName: v.sheetName || null,
    headerRow: v.headerRow,
    delimiter: v.delimiter,
    encoding: v.encoding,
    decimalSep: v.decimalSep,
    thousandsSep: v.thousandsSep,
    dateFormat: v.dateFormat,
    signMode: v.signMode,
    colDate: v.colDate,
    colDescription: v.colDescription,
    colAmount: v.colAmount || null,
    colDebit: v.colDebit || null,
    colCredit: v.colCredit || null,
    colType: v.colType || null,
    typeIncomeValue: v.typeIncomeValue || null,
    typeExpenseValue: v.typeExpenseValue || null,
    colAccount: v.colAccount || null,
    colCategory: v.colCategory || null,
    colPaymentMethod: v.colPaymentMethod || null,
    colNotes: v.colNotes || null,
    forceAbs: v.forceAbs,
    invertSigns: v.invertSigns,
    skipRowsContaining: v.skipRowsContaining || null,
  };

  // Helper: in UPDATE Prisma vuole connect/disconnect per le relation typed,
  // mentre in CREATE accetta direttamente lo scalar FK. Costruiamo i due payload.
  const relUpdate = {
    defaultBankAccount: v.defaultBankAccountId
      ? { connect: { id: v.defaultBankAccountId } }
      : { disconnect: true as const },
    defaultCategoryExpense: v.defaultCategoryExpenseId
      ? { connect: { id: v.defaultCategoryExpenseId } }
      : { disconnect: true as const },
    defaultCategoryIncome: v.defaultCategoryIncomeId
      ? { connect: { id: v.defaultCategoryIncomeId } }
      : { disconnect: true as const },
    defaultPaymentMethod: v.defaultPaymentMethodId
      ? { connect: { id: v.defaultPaymentMethodId } }
      : { disconnect: true as const },
  };
  const fkCreate = {
    defaultBankAccountId: v.defaultBankAccountId || null,
    defaultCategoryExpenseId: v.defaultCategoryExpenseId || null,
    defaultCategoryIncomeId: v.defaultCategoryIncomeId || null,
    defaultPaymentMethodId: v.defaultPaymentMethodId || null,
  };

  try {
    let id: string;
    if (v.id) {
      const existing = await prisma.importTemplate.findFirst({
        where: { id: v.id, holderId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Template non trovato" };
      const updated = await prisma.importTemplate.update({
        where: { id: v.id },
        data: { ...scalarData, ...relUpdate },
      });
      id = updated.id;
    } else {
      const created = await prisma.importTemplate.create({
        data: { holderId, ...scalarData, ...fkCreate },
      });
      id = created.id;
    }
    revalidatePath("/importazioni");
    revalidatePath("/importazioni/templates");
    return { ok: true, id };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, error: "Esiste già un template con questo nome" };
    }
    return { ok: false, error: "Errore salvataggio: " + (e?.message ?? "sconosciuto") };
  }
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const t = await prisma.importTemplate.findFirst({
    where: { id, holderId },
    select: { id: true },
  });
  if (!t) return { ok: false, error: "Template non trovato" };
  await prisma.importTemplate.delete({ where: { id } });
  revalidatePath("/importazioni");
  revalidatePath("/importazioni/templates");
  return { ok: true };
}

export async function duplicateTemplate(id: string): Promise<ActionResult<{ id: string }>> {
  const { holderId } = await requireHolder();
  const t = await prisma.importTemplate.findFirst({
    where: { id, holderId },
  });
  if (!t) return { ok: false, error: "Template non trovato" };

  // Trova un nome libero "Nome (copia)", "Nome (copia 2)", ...
  let base = `${t.name} (copia)`;
  let candidate = base;
  let i = 2;
  while (
    await prisma.importTemplate.findFirst({
      where: { holderId, name: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${base} ${i}`;
    i++;
  }

  const created = await prisma.importTemplate.create({
    data: {
      holderId,
      name: candidate,
      sourceLabel: t.sourceLabel,
      fileType: t.fileType,
      sheetName: t.sheetName,
      headerRow: t.headerRow,
      delimiter: t.delimiter,
      encoding: t.encoding,
      decimalSep: t.decimalSep,
      thousandsSep: t.thousandsSep,
      dateFormat: t.dateFormat,
      signMode: t.signMode,
      colDate: t.colDate,
      colDescription: t.colDescription,
      colAmount: t.colAmount,
      colDebit: t.colDebit,
      colCredit: t.colCredit,
      colType: t.colType,
      typeIncomeValue: t.typeIncomeValue,
      typeExpenseValue: t.typeExpenseValue,
      colAccount: t.colAccount,
      colCategory: t.colCategory,
      colPaymentMethod: t.colPaymentMethod,
      colNotes: t.colNotes,
      defaultBankAccountId: t.defaultBankAccountId,
      defaultCategoryExpenseId: t.defaultCategoryExpenseId,
      defaultCategoryIncomeId: t.defaultCategoryIncomeId,
      defaultPaymentMethodId: t.defaultPaymentMethodId,
      forceAbs: t.forceAbs,
      invertSigns: t.invertSigns,
      skipRowsContaining: t.skipRowsContaining,
    },
  });
  revalidatePath("/importazioni/templates");
  return { ok: true, id: created.id };
}

// ============== Mapping ==============

const MAPPING_KINDS = ["ACCOUNT", "CATEGORY", "PAYMENT_METHOD"] as const;
const MATCH_TYPES = ["EXACT", "CONTAINS", "STARTS_WITH", "REGEX"] as const;

const mappingInputSchema = z
  .object({
    id: z.string().optional(),
    templateId: z.string().min(1),
    kind: z.enum(MAPPING_KINDS),
    matchType: z.enum(MATCH_TYPES).default("EXACT"),
    sourceValueRaw: z.string().trim().min(1, "Pattern obbligatorio").max(200),
    targetId: z.string().min(1, "Selezionare la destinazione"),
  });

export type MappingInput = z.infer<typeof mappingInputSchema>;

export async function saveMapping(raw: MappingInput): Promise<ActionResult<{ id: string }>> {
  const { holderId } = await requireHolder();
  const parse = mappingInputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  const tpl = await prisma.importTemplate.findFirst({
    where: { id: v.templateId, holderId },
    select: { id: true },
  });
  if (!tpl) return { ok: false, error: "Template non trovato" };

  // Verifica ownership della target entity
  if (v.kind === "ACCOUNT") {
    const ok = await prisma.bankAccount.findFirst({
      where: { id: v.targetId, holderId },
      select: { id: true },
    });
    if (!ok) return { ok: false, error: "Conto non valido" };
  } else if (v.kind === "CATEGORY") {
    const ok = await prisma.category.findFirst({
      where: { id: v.targetId, holderId },
      select: { id: true },
    });
    if (!ok) return { ok: false, error: "Categoria non valida" };
  } else if (v.kind === "PAYMENT_METHOD") {
    const ok = await prisma.paymentMethod.findFirst({
      where: { id: v.targetId, holderId },
      select: { id: true },
    });
    if (!ok) return { ok: false, error: "Modalità non valida" };
  }

  const sourceValueNorm = v.sourceValueRaw.toLowerCase().trim();

  const data: any = {
    matchType: v.matchType,
    sourceValueRaw: v.sourceValueRaw,
    sourceValueNorm,
    bankAccountId: v.kind === "ACCOUNT" ? v.targetId : null,
    categoryId: v.kind === "CATEGORY" ? v.targetId : null,
    paymentMethodId: v.kind === "PAYMENT_METHOD" ? v.targetId : null,
  };

  try {
    let id: string;
    if (v.id) {
      const existing = await prisma.importMapping.findFirst({
        where: { id: v.id, holderId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Mapping non trovato" };
      const updated = await prisma.importMapping.update({
        where: { id: v.id },
        data,
      });
      id = updated.id;
    } else {
      // Upsert su (holderId, templateId, kind, matchType, sourceValueNorm)
      const created = await prisma.importMapping.upsert({
        where: {
          holderId_templateId_kind_matchType_sourceValueNorm: {
            holderId,
            templateId: v.templateId,
            kind: v.kind,
            matchType: v.matchType,
            sourceValueNorm,
          },
        },
        create: {
          holderId,
          templateId: v.templateId,
          kind: v.kind,
          ...data,
        },
        update: data,
      });
      id = created.id;
    }
    revalidatePath(`/importazioni/templates/${v.templateId}`);
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: "Errore salvataggio: " + (e?.message ?? "sconosciuto") };
  }
}

export async function deleteMapping(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const m = await prisma.importMapping.findFirst({
    where: { id, holderId },
    select: { id: true, templateId: true },
  });
  if (!m) return { ok: false, error: "Mapping non trovato" };
  await prisma.importMapping.delete({ where: { id } });
  revalidatePath(`/importazioni/templates/${m.templateId}`);
  return { ok: true };
}

// ============== Import: preview + commit ==============

export type PreviewResult =
  | {
      ok: true;
      templateId: string;
      fileName: string;
      rows: ProcessedRow[];
      headers: string[];
      warnings: string[];
      summary: {
        total: number;
        ready: number;
        duplicate: number;
        needsMapping: number;
        error: number;
      };
      diagnostics: {
        totalTransactionsInDb: number;
        hashesInDb: number;
        backfilledNow: number;
      };
    }
  | { ok: false; error: string };

function templateToEngine(t: any): EngineTemplate {
  return {
    decimalSep: t.decimalSep,
    thousandsSep: t.thousandsSep,
    dateFormat: t.dateFormat,
    signMode: t.signMode,
    colDate: t.colDate,
    colDescription: t.colDescription,
    colAmount: t.colAmount,
    colDebit: t.colDebit,
    colCredit: t.colCredit,
    colType: t.colType,
    typeIncomeValue: t.typeIncomeValue,
    typeExpenseValue: t.typeExpenseValue,
    colAccount: t.colAccount,
    colCategory: t.colCategory,
    colPaymentMethod: t.colPaymentMethod,
    colNotes: t.colNotes,
    defaultBankAccountId: t.defaultBankAccountId,
    defaultCategoryExpenseId: t.defaultCategoryExpenseId,
    defaultCategoryIncomeId: t.defaultCategoryIncomeId,
    defaultPaymentMethodId: t.defaultPaymentMethodId,
    forceAbs: t.forceAbs,
    invertSigns: t.invertSigns,
    skipRowsContaining: t.skipRowsContaining,
  };
}

/**
 * Riceve il file dal client come FormData (templateId + file).
 * Esegue parsing + processing e ritorna ProcessedRow per la preview.
 * NON scrive nulla nel DB.
 */
export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const { holderId } = await requireHolder();
  const templateId = formData.get("templateId");
  const file = formData.get("file");
  if (typeof templateId !== "string" || !templateId) {
    return { ok: false, error: "Template non specificato" };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: "Nessun file caricato" };
  }

  const tpl = await prisma.importTemplate.findFirst({
    where: { id: templateId, holderId },
    include: { mappings: true },
  });
  if (!tpl) return { ok: false, error: "Template non trovato" };

  const engine = templateToEngine(tpl);
  const mappings: EngineMapping[] = tpl.mappings.map((m) => ({
    kind: m.kind as EngineMapping["kind"],
    matchType: (m.matchType ?? "EXACT") as EngineMapping["matchType"],
    sourceValueNorm: m.sourceValueNorm,
    sourceValueRaw: m.sourceValueRaw,
    targetId: (m.bankAccountId ?? m.categoryId ?? m.paymentMethodId)!,
  }));

  let parsed;
  try {
    if (tpl.fileType === "csv") {
      const text = await file.text();
      parsed = parseCsv(text, {
        delimiter: tpl.delimiter,
        headerRow: tpl.headerRow,
      });
    } else {
      const buf = await file.arrayBuffer();
      parsed = parseXlsx(buf, {
        sheetName: tpl.sheetName ?? undefined,
        headerRow: tpl.headerRow,
      });
    }
  } catch (e: any) {
    return { ok: false, error: "Errore lettura file: " + (e?.message ?? "sconosciuto") };
  }

  if (parsed.headers.length === 0) {
    return { ok: false, error: "Nessuna intestazione trovata. Controlla la 'Riga delle intestazioni' nel template." };
  }

  // Diagnostica: verifica che le colonne configurate esistano nelle intestazioni
  const headersSet = new Set(parsed.headersNorm);
  const missing: string[] = [];
  const required: Array<[string, string | null | undefined]> = [
    ["Data", tpl.colDate],
    ["Descrizione", tpl.colDescription],
  ];
  if (tpl.signMode === "SIGNED" || tpl.signMode === "AMOUNT_PLUS_TYPE") {
    required.push(["Importo", tpl.colAmount]);
  }
  if (tpl.signMode === "DEBIT_CREDIT") {
    required.push(["Dare", tpl.colDebit]);
    required.push(["Avere", tpl.colCredit]);
  }
  if (tpl.signMode === "AMOUNT_PLUS_TYPE") {
    required.push(["Tipo", tpl.colType]);
  }
  for (const [label, val] of required) {
    if (!val) {
      missing.push(label);
      continue;
    }
    const norm = val.trim().toLowerCase().replace(/\s+/g, " ").replace(/[\s:;,.]+$/g, "");
    if (!headersSet.has(norm)) {
      missing.push(`${label} ("${val}")`);
    }
  }
  if (missing.length > 0) {
    const foundHeaders = parsed.headers.slice(0, 20).join(" · ");
    return {
      ok: false,
      error: `Colonne non trovate nel file: ${missing.join(", ")}.\n\nIntestazioni rilevate nel file (riga ${tpl.headerRow}): ${foundHeaders}\n\nVerifica nel template: nome delle colonne, riga delle intestazioni, delimitatore.`,
    };
  }

  // Backfill: se ci sono Transaction senza importHash (es. movimenti inseriti prima
  // dell'introduzione del campo), li popoliamo ora così il check duplicati funziona
  // anche contro lo storico manuale.
  const backfilledNow = await backfillMissingHashesForHolder(holderId);
  console.log(
    `[import preview] holder=${holderId} backfilledNow=${backfilledNow}`,
  );

  // Hash esistenti — TUTTI i movimenti dell'utente (manuali + importati).
  // Carico anche date/amount/type per costruire la weak-key (data+importo+tipo) che
  // permette di rilevare "possibili duplicati" anche con descrizione diversa.
  const existing = await prisma.transaction.findMany({
    where: { holderId },
    select: { importHash: true, date: true, amount: true, type: true },
  });
  const existingHashes = new Set<string>();
  const existingWeakKeys = new Set<string>();
  for (const r of existing) {
    if (r.importHash) existingHashes.add(r.importHash);
    existingWeakKeys.add(
      computeTransactionWeakKey({
        date: r.date,
        amount: r.amount,
        type: r.type as "income" | "expense",
      }),
    );
  }
  console.log(
    `[import preview] totalTx=${existing.length} hashesInDb=${existingHashes.size} weakKeysInDb=${existingWeakKeys.size}`,
  );

  const rows = processRows(parsed, engine, mappings, existingHashes, existingWeakKeys);

  const summary = {
    total: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    needsMapping: rows.filter((r) => r.status === "needs_mapping").length,
    error: rows.filter((r) => r.status === "error").length,
  };

  return {
    ok: true,
    templateId,
    fileName: file.name,
    rows,
    headers: parsed.headers,
    warnings: parsed.warnings,
    summary,
    diagnostics: {
      totalTransactionsInDb: existing.length,
      hashesInDb: existingHashes.size,
      backfilledNow,
    },
  };
}

// ----- Commit -----

const commitRowSchema = z.object({
  rowIndex: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(500),
  amount: z.number().positive(),
  type: z.enum(["income", "expense"]),
  notes: z.string().nullable().optional(),
  bankAccountId: z.string().min(1),
  categoryId: z.string().min(1),
  paymentMethodId: z.string().nullable().optional(),
  // Valori sorgente: servono al server per "imparare" nuovi mapping in automatico.
  sourceAccount: z.string().default(""),
  sourceCategory: z.string().default(""),
  sourcePayment: z.string().default(""),
});

// Regole "imparate" durante la preview: pattern + matchType + target.
// Il client le accumula quando l'utente applica una regola bulk dalla preview.
const learnedRuleSchema = z.object({
  kind: z.enum(["ACCOUNT", "CATEGORY", "PAYMENT_METHOD"]),
  matchType: z.enum(["EXACT", "CONTAINS", "STARTS_WITH", "REGEX"]),
  pattern: z.string().trim().min(1).max(200),
  targetId: z.string().min(1),
});

const commitInputSchema = z.object({
  templateId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  rows: z.array(commitRowSchema).min(1, "Nessuna riga da importare"),
  // Totali per il batch (informativi)
  totalRows: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  errorCount: z.number().int().min(0),
  // Regole esplicite proposte in preview (verranno salvate come ImportMapping)
  rulesToSave: z.array(learnedRuleSchema).default([]),
});

// Backfill hash sui movimenti che non lo hanno (manuali pre-feature, import legacy, ecc.).
// Idempotente: ricalcola solo dove importHash è null.
async function backfillMissingHashesForHolder(holderId: string): Promise<number> {
  const without = await prisma.transaction.findMany({
    where: { holderId, importHash: null },
    select: { id: true, date: true, amount: true, type: true, description: true },
  });
  if (without.length === 0) return 0;
  // Eseguiamo in piccoli batch per non saturare la connessione.
  const BATCH = 100;
  for (let i = 0; i < without.length; i += BATCH) {
    const chunk = without.slice(i, i + BATCH);
    await Promise.all(
      chunk.map((t) => {
        const hash = computeTransactionHash({
          date: t.date,
          amount: t.amount,
          type: t.type as "income" | "expense",
          description: t.description,
        });
        return prisma.transaction.update({
          where: { id: t.id },
          data: { importHash: hash },
        });
      }),
    );
  }
  return without.length;
}

// Action pubblica per ricalcolare manualmente da UI (es. dopo edit massivi).
// Ricalcola TUTTI gli hash, non solo quelli mancanti.
export async function recomputeAllHashes(): Promise<ActionResult<{ updated: number }>> {
  const { holderId } = await requireHolder();
  const all = await prisma.transaction.findMany({
    where: { holderId },
    select: { id: true, date: true, amount: true, type: true, description: true },
  });
  const BATCH = 100;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    await Promise.all(
      chunk.map((t) => {
        const hash = computeTransactionHash({
          date: t.date,
          amount: t.amount,
          type: t.type as "income" | "expense",
          description: t.description,
        });
        return prisma.transaction.update({
          where: { id: t.id },
          data: { importHash: hash },
        });
      }),
    );
  }
  return { ok: true, updated: all.length };
}

export type CommitInput = z.infer<typeof commitInputSchema>;
export type CommitResult =
  | { ok: true; batchId: string; importedCount: number; duplicateInBatch: number }
  | { ok: false; error: string };

export async function commitImport(input: CommitInput): Promise<CommitResult> {
  const { holderId } = await requireHolder();
  const parse = commitInputSchema.safeParse(input);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  // Verifica template appartiene all'utente
  const tpl = await prisma.importTemplate.findFirst({
    where: { id: v.templateId, holderId },
    select: { id: true },
  });
  if (!tpl) return { ok: false, error: "Template non trovato" };

  // Verifica ownership delle entità di tutte le righe (batch query)
  const accountIds = Array.from(new Set(v.rows.map((r) => r.bankAccountId)));
  const categoryIds = Array.from(new Set(v.rows.map((r) => r.categoryId)));
  const paymentIds = Array.from(
    new Set(v.rows.map((r) => r.paymentMethodId).filter(Boolean) as string[]),
  );

  const [accCount, catCount, pmCount] = await Promise.all([
    prisma.bankAccount.count({ where: { id: { in: accountIds }, holderId } }),
    prisma.category.count({ where: { id: { in: categoryIds }, holderId } }),
    paymentIds.length === 0
      ? Promise.resolve(0)
      : prisma.paymentMethod.count({ where: { id: { in: paymentIds }, holderId } }),
  ]);
  if (accCount !== accountIds.length) {
    return { ok: false, error: "Una o più righe hanno un conto non valido" };
  }
  if (catCount !== categoryIds.length) {
    return { ok: false, error: "Una o più righe hanno una categoria non valida" };
  }
  if (pmCount !== paymentIds.length) {
    return { ok: false, error: "Una o più righe hanno una modalità non valida" };
  }

  // Ricalcola hash server-side e ricontrolla duplicati al momento del commit
  // (potrebbero esserci nuovi movimenti aggiunti dopo la preview)
  const rowsWithHash = v.rows.map((r) => ({
    ...r,
    hash: computeTransactionHash({
      date: r.date,
      amount: r.amount,
      type: r.type,
      description: r.description,
    }),
  }));

  const allHashes = rowsWithHash.map((r) => r.hash);
  const existing = await prisma.transaction.findMany({
    where: { holderId, importHash: { in: allHashes } },
    select: { importHash: true },
  });
  const existingSet = new Set<string>();
  for (const e of existing) if (e.importHash) existingSet.add(e.importHash);

  // Filtra le righe rimanenti, evitando anche duplicati interni al payload
  const seen = new Set<string>();
  const toInsert: typeof rowsWithHash = [];
  let duplicateInBatch = 0;
  for (const r of rowsWithHash) {
    if (existingSet.has(r.hash) || seen.has(r.hash)) {
      duplicateInBatch++;
      continue;
    }
    seen.add(r.hash);
    toInsert.push(r);
  }

  if (toInsert.length === 0) {
    // Nessuna riga effettivamente importabile (tutte duplicate)
    // Creiamo comunque il batch per tracciabilità
    const batch = await prisma.importBatch.create({
      data: {
        holderId,
        templateId: v.templateId,
        fileName: v.fileName,
        totalRows: v.totalRows,
        importedCount: 0,
        duplicateCount: v.duplicateCount + duplicateInBatch,
        errorCount: v.errorCount,
      },
    });
    revalidatePath("/importazioni");
    revalidatePath("/movimenti");
    revalidatePath("/dashboard");
    revalidatePath("/conti");
    return {
      ok: true,
      batchId: batch.id,
      importedCount: 0,
      duplicateInBatch,
    };
  }

  // Costruisci la lista dei mapping da apprendere/salvare.
  // Due fonti:
  //  1) Regole esplicite proposte in preview (rulesToSave) — pattern + matchType qualunque.
  //     È la fonte primaria per le CATEGORY (con pattern intelligente).
  //  2) Implicito per ACCOUNT e PAYMENT_METHOD: salvo come EXACT il valore sorgente di quelle
  //     righe importate dove l'utente ha risolto un conto/modalità inline. Niente learning
  //     automatico di CATEGORY da sourceValue: vuoi sempre pattern espliciti per quello.
  type LearnedMapping = {
    kind: "ACCOUNT" | "CATEGORY" | "PAYMENT_METHOD";
    matchType: "EXACT" | "CONTAINS" | "STARTS_WITH" | "REGEX";
    sourceValueRaw: string;
    sourceValueNorm: string;
    targetId: string;
  };
  const learnedMap = new Map<string, LearnedMapping>();
  const pushMapping = (m: LearnedMapping) => {
    const key = `${m.kind}::${m.matchType}::${m.sourceValueNorm}`;
    if (learnedMap.has(key)) return; // primo wins
    learnedMap.set(key, m);
  };
  // 1) Esplicite
  for (const rule of v.rulesToSave) {
    pushMapping({
      kind: rule.kind,
      matchType: rule.matchType,
      sourceValueRaw: rule.pattern,
      sourceValueNorm: rule.pattern.toLowerCase().trim(),
      targetId: rule.targetId,
    });
  }
  // 2) Implicite per ACCOUNT/PAYMENT_METHOD (EXACT su sourceValue)
  for (const r of toInsert) {
    if (r.sourceAccount && r.sourceAccount.trim() && r.bankAccountId) {
      const s = r.sourceAccount.trim();
      pushMapping({
        kind: "ACCOUNT",
        matchType: "EXACT",
        sourceValueRaw: s,
        sourceValueNorm: s.toLowerCase(),
        targetId: r.bankAccountId,
      });
    }
    if (r.sourcePayment && r.sourcePayment.trim() && r.paymentMethodId) {
      const s = r.sourcePayment.trim();
      pushMapping({
        kind: "PAYMENT_METHOD",
        matchType: "EXACT",
        sourceValueRaw: s,
        sourceValueNorm: s.toLowerCase(),
        targetId: r.paymentMethodId,
      });
    }
  }
  const learnedMappings = [...learnedMap.values()];

  // Transazione: crea batch + tutte le righe + upsert dei mapping appresi
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        holderId,
        templateId: v.templateId,
        fileName: v.fileName,
        totalRows: v.totalRows,
        importedCount: toInsert.length,
        duplicateCount: v.duplicateCount + duplicateInBatch,
        errorCount: v.errorCount,
      },
    });

    // I movimenti che arrivano da import bancario vengono marcati come riconciliati di default
    // (sono presi direttamente dall'estratto della banca → corrispondono per definizione)
    // e taggati con una nota "Import: NOMEFILE" così sono raggruppabili nei filtri.
    const importedAt = new Date();
    const importNote = `Import: ${v.fileName}`.slice(0, 200);
    await tx.transaction.createMany({
      data: toInsert.map((r) => ({
        holderId,
        date: new Date(r.date + "T00:00:00.000Z"),
        description: r.description,
        amount: r.amount,
        type: r.type,
        notes: r.notes || null,
        bankAccountId: r.bankAccountId,
        categoryId: r.categoryId,
        paymentMethodId: r.paymentMethodId || null,
        importHash: r.hash,
        importBatchId: batch.id,
        reconciled: true,
        reconciledAt: importedAt,
        reconciliationNote: importNote,
      })),
    });

    // Upsert dei mapping nuovi (silenzioso: non sovrascrive quelli già esistenti)
    for (const lm of learnedMappings) {
      await tx.importMapping.upsert({
        where: {
          holderId_templateId_kind_matchType_sourceValueNorm: {
            holderId,
            templateId: v.templateId,
            kind: lm.kind,
            matchType: lm.matchType,
            sourceValueNorm: lm.sourceValueNorm,
          },
        },
        create: {
          holderId,
          templateId: v.templateId,
          kind: lm.kind,
          matchType: lm.matchType,
          sourceValueRaw: lm.sourceValueRaw,
          sourceValueNorm: lm.sourceValueNorm,
          bankAccountId: lm.kind === "ACCOUNT" ? lm.targetId : null,
          categoryId: lm.kind === "CATEGORY" ? lm.targetId : null,
          paymentMethodId: lm.kind === "PAYMENT_METHOD" ? lm.targetId : null,
        },
        // Non aggiorno se esiste già: rispetto la scelta precedente dell'utente.
        update: {},
      });
    }

    return batch;
  });

  // Revalidate anche la pagina del template, dove l'utente vede i mappings cumulativi
  revalidatePath(`/importazioni/templates/${v.templateId}`);

  revalidatePath("/importazioni");
  revalidatePath("/movimenti");
  revalidatePath("/dashboard");
  revalidatePath("/budget");
  revalidatePath("/conti");
  revalidatePath("/forecast");
  return {
    ok: true,
    batchId: result.id,
    importedCount: toInsert.length,
    duplicateInBatch,
  };
}
