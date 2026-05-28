"use server";

/**
 * Server Actions per CRUD movimenti.
 * Sempre auth check + verifica ownership prima di scrivere.
 */
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "crypto";
import { computeTransactionHash } from "@/lib/import-hash";

const inputSchema = z.object({
  id: z.string().optional(),
  date: z.string().min(8), // "YYYY-MM-DD"
  // Limite alto perché i sync PSD2 (Mediolanum & co.) possono produrre
  // descrizioni di 400-600+ caratteri (causale + codici carta + metadati).
  description: z.string().trim().min(1, "Descrizione obbligatoria").max(1000),
  amount: z.coerce
    .number()
    .positive("Importo deve essere positivo")
    .max(1_000_000),
  type: z.enum(["income", "expense"]),
  categoryId: z.string().min(1, "Categoria obbligatoria"),
  bankAccountId: z.string().min(1, "Conto obbligatorio"),
  paymentMethodId: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  // Riconciliazione (opzionali — undefined = non toccare in update, default false in create)
  reconciled: z.coerce.boolean().optional(),
  reconciliationNote: z.string().trim().max(200).optional().nullable(),
  // Conto di contropartita per le causali di trasferimento.
  // Richiesto SE la category selezionata ha isTransfer=true.
  // Il sistema crea automaticamente un movimento speculare sull'altro
  // conto, legandolo a questo tramite transferGroupId condiviso.
  counterpartBankAccountId: z.string().trim().min(1).nullable().optional(),
});

export type MovimentoInput = z.infer<typeof inputSchema>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function requireHolder() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

/**
 * Crea o aggiorna un movimento. Se `id` è presente → update, altrimenti create.
 *
 * Gestione TRASFERIMENTI (giroconti tra conti):
 *  - Se la category selezionata ha isTransfer=true, è obbligatorio passare
 *    `counterpartBankAccountId` (un conto dell'Holder diverso da bankAccountId).
 *  - Il sistema crea/aggiorna un movimento SPECULARE sull'altro conto:
 *      • stesso transferGroupId (UUID condiviso)
 *      • type opposto (income ↔ expense)
 *      • stesso importo assoluto, stessa data, stessa descrizione e note
 *      • category = counterpartCategoryId della prima categoria (se valorizzata),
 *        altrimenti la STESSA categoria (caso degenere ma supportato)
 *  - In UPDATE, le modifiche si propagano al sibling (incluso cambio conto
 *    contropartita) e si gestiscono le transizioni:
 *      • non-transfer → transfer: crea sibling
 *      • transfer → non-transfer: elimina sibling
 *      • transfer → transfer (categoria/conto cambiati): aggiorna sibling
 *
 * Tutta la pipeline è in prisma.$transaction per garantire atomicità: o
 * vengono scritti entrambi i lati, o nessuno.
 */
export async function saveMovimento(raw: MovimentoInput): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const parse = inputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  // Ownership check su categoria, conto, modalità — tutto scoped sull'Holder attivo
  const [cat, acc, pm] = await Promise.all([
    prisma.category.findFirst({
      where: { id: v.categoryId, holderId },
      // isTransfer + counterpartCategoryId servono per decidere se creare
      // il movimento speculare e con quale categoria taggarlo.
      select: {
        id: true,
        type: true,
        isTransfer: true,
        counterpartCategoryId: true,
      },
    }),
    prisma.bankAccount.findFirst({ where: { id: v.bankAccountId, holderId } }),
    v.paymentMethodId
      ? prisma.paymentMethod.findFirst({ where: { id: v.paymentMethodId, holderId } })
      : null,
  ]);
  if (!cat) return { ok: false, error: "Categoria non valida" };
  if (!acc) return { ok: false, error: "Conto non valido" };
  if (v.paymentMethodId && !pm) return { ok: false, error: "Modalità non valida" };

  // ─── Validazione e setup TRASFERIMENTO ────────────────────────────
  // isPairing = il movimento DOVRÀ avere un sibling sull'altro conto.
  const isPairing = cat.isTransfer === true;
  let counterpartAccount: { id: string } | null = null;
  let counterpartCategory: { id: string; type: string } | null = null;

  if (isPairing) {
    if (!v.counterpartBankAccountId) {
      return {
        ok: false,
        error: "Per le causali di trasferimento è obbligatorio scegliere il conto di contropartita",
      };
    }
    if (v.counterpartBankAccountId === v.bankAccountId) {
      return {
        ok: false,
        error: "Il conto di contropartita deve essere diverso dal conto del movimento",
      };
    }
    counterpartAccount = await prisma.bankAccount.findFirst({
      where: { id: v.counterpartBankAccountId, holderId },
      select: { id: true },
    });
    if (!counterpartAccount) {
      return { ok: false, error: "Conto di contropartita non valido" };
    }
    // Risolvi la category da usare sull'altro lato del giroconto.
    // Default: stessa category (caso degenere ma legittimo).
    // Override: cat.counterpartCategoryId se valorizzata e dell'Holder.
    if (cat.counterpartCategoryId) {
      const c = await prisma.category.findFirst({
        where: { id: cat.counterpartCategoryId, holderId },
        select: { id: true, type: true },
      });
      if (!c) {
        return {
          ok: false,
          error: "La categoria di contropartita configurata non esiste più nell'anagrafica",
        };
      }
      counterpartCategory = c;
    } else {
      counterpartCategory = { id: cat.id, type: cat.type };
    }
  }

  const txDate = new Date(v.date + "T12:00:00"); // mezzogiorno per evitare drift TZ
  const importHash = computeTransactionHash({
    date: txDate,
    amount: Math.abs(v.amount),
    type: v.type,
    description: v.description,
  });

  // Tipo speculare per il sibling: opposto del type principale.
  // (Anche se counterpartCategory.type indicasse altro, qui contano i SOLDI:
  // se da Mediolanum esce 100 €, in Cassa entrano 100 €.)
  const counterpartType: "income" | "expense" =
    v.type === "income" ? "expense" : "income";

  // Dati comuni al movimento principale.
  // NB: per il sibling NON ricalcoliamo importHash con type opposto perché
  // l'hash serve alla dedup dell'import file, non ai giroconti manuali;
  // i sibling generati automaticamente NON vengono mai matchati con file
  // import (non ne hanno l'origine).
  const baseData = {
    holderId,
    date: txDate,
    description: v.description,
    amount: Math.abs(v.amount),
    type: v.type,
    categoryId: v.categoryId,
    bankAccountId: v.bankAccountId,
    paymentMethodId: v.paymentMethodId || null,
    notes: v.notes || null,
    importHash,
  };

  try {
    const savedId = await prisma.$transaction(async (tx) => {
      let mainId: string;
      let groupId: string | null = null;
      // Esistente: serve per gestire le transizioni transfer ↔ non-transfer
      // e per identificare il sibling da aggiornare/eliminare.
      let prevGroupId: string | null = null;

      if (v.id) {
        const existing = await tx.transaction.findFirst({
          where: { id: v.id, holderId },
          select: { id: true, transferGroupId: true },
        });
        if (!existing) {
          throw new Error("Movimento non trovato");
        }
        prevGroupId = existing.transferGroupId;

        // Calcola updates di riconciliazione (solo se passati esplicitamente).
        // NB: la riconciliazione vale sul singolo movimento, NON si propaga
        // automaticamente al sibling (potrebbe essere riconciliato in tempi
        // diversi rispetto al lato cassa che non ha estratto).
        const recPatch: Record<string, unknown> = {};
        if (v.reconciled !== undefined) {
          recPatch.reconciled = v.reconciled;
          recPatch.reconciledAt = v.reconciled ? new Date() : null;
        }
        if (v.reconciliationNote !== undefined) {
          recPatch.reconciliationNote = v.reconciliationNote || null;
        }

        // Decide transferGroupId del MAIN dopo update:
        //  - se era pairing E resta pairing → mantieni prevGroupId
        //  - se NON era pairing E ora lo è → genera nuovo
        //  - se NON è pairing → null
        if (isPairing) {
          groupId = prevGroupId ?? randomUUID();
        } else {
          groupId = null;
        }

        const updated = await tx.transaction.update({
          where: { id: v.id },
          data: { ...baseData, transferGroupId: groupId, ...recPatch },
        });
        mainId = updated.id;
      } else {
        const recCreate: Record<string, unknown> = {
          reconciled: v.reconciled ?? false,
          reconciledAt: v.reconciled ? new Date() : null,
          reconciliationNote: v.reconciliationNote || null,
        };
        groupId = isPairing ? randomUUID() : null;
        const created = await tx.transaction.create({
          data: { ...baseData, transferGroupId: groupId, ...recCreate },
        });
        mainId = created.id;
      }

      // ─── Gestione SIBLING (movimento speculare) ─────────────────────
      // Trova eventuale sibling preesistente nel gruppo.
      const siblingExisting = prevGroupId
        ? await tx.transaction.findFirst({
            where: {
              holderId,
              transferGroupId: prevGroupId,
              id: { not: mainId },
            },
            select: { id: true, reconciled: true },
          })
        : null;

      if (isPairing && counterpartAccount && counterpartCategory && groupId) {
        // Dati del sibling: stesso importo, type opposto, conto opposto,
        // categoria di contropartita (o stessa se non configurata).
        // Niente paymentMethod sul sibling (il "metodo" tipico del
        // giroconto è implicito: bonifico/giroconto interno).
        const siblingData = {
          holderId,
          date: txDate,
          description: v.description,
          amount: Math.abs(v.amount),
          type: counterpartType,
          categoryId: counterpartCategory.id,
          bankAccountId: counterpartAccount.id,
          paymentMethodId: null,
          notes: v.notes || null,
          transferGroupId: groupId,
          importHash: null,
        };

        if (siblingExisting) {
          // Aggiorna sibling esistente. Manteniamo il suo stato di
          // riconciliazione invariato (vedi commento sopra).
          await tx.transaction.update({
            where: { id: siblingExisting.id },
            data: siblingData,
          });
        } else {
          await tx.transaction.create({
            data: { ...siblingData, reconciled: false },
          });
        }
      } else if (siblingExisting) {
        // Transizione transfer → non-transfer: elimina il sibling orfano.
        await tx.transaction.delete({ where: { id: siblingExisting.id } });
      }

      return mainId;
    });

    revalidatePath("/movimenti");
    revalidatePath("/dashboard");
    return { ok: true, id: savedId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore inatteso";
    return { ok: false, error: msg };
  }
}

/**
 * Duplica un movimento esistente creando un nuovo record con:
 *  - stessa descrizione, importo, type, categoria, conto, modalità, note
 *  - data = oggi (l'uso tipico è "ho rifatto la stessa spesa")
 *  - reconciled = false (un duplicato non è ancora stato visto sull'estratto)
 *  - NON viene duplicato il transferGroupId né il sibling: se l'originale
 *    era un giroconto, la duplicazione produce un movimento isolato che
 *    l'utente può poi convertire in giroconto se serve (la causale di
 *    trasferimento è preservata, quindi se apre il dialog del nuovo
 *    movimento si attiverà di nuovo la richiesta del conto contropartita).
 *
 * Importante: NON viene creato il sibling automaticamente perché non
 * abbiamo il conto contropartita (l'utente l'avrebbe scelto al momento).
 * Per i giroconti, l'utente deve aprire il duplicato e completarlo.
 *
 * Ritorna l'id del nuovo movimento creato.
 */
export async function duplicateMovimento(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const src = await prisma.transaction.findFirst({
    where: { id, holderId },
    select: {
      description: true,
      amount: true,
      type: true,
      categoryId: true,
      bankAccountId: true,
      paymentMethodId: true,
      notes: true,
      category: { select: { isTransfer: true } },
    },
  });
  if (!src) return { ok: false, error: "Movimento non trovato" };

  // Se la categoria sorgente è un trasferimento, NON creiamo il duplicato
  // server-side (mancherebbe il conto contropartita). Invece restituiamo
  // un errore strutturato che la UI può intercettare per aprire il dialog
  // pre-compilato senza salvare nulla.
  // Lo gestiamo lato client: il bottone "Duplica" passa per il dialog,
  // non chiama direttamente questa action quando la categoria è transfer.
  // Qui restiamo difensivi:
  if (src.category.isTransfer) {
    return {
      ok: false,
      error:
        "Questo è un giroconto: usa 'Duplica' dal dialog per scegliere il nuovo conto di contropartita",
    };
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0); // mezzogiorno (consistente con saveMovimento)
  const todayIso = today.toISOString().slice(0, 10);
  const txDate = new Date(todayIso + "T12:00:00");

  const importHash = computeTransactionHash({
    date: txDate,
    amount: Math.abs(src.amount),
    type: src.type as "income" | "expense",
    description: src.description,
  });

  const created = await prisma.transaction.create({
    data: {
      holderId,
      date: txDate,
      description: src.description,
      amount: Math.abs(src.amount),
      type: src.type as "income" | "expense",
      categoryId: src.categoryId,
      bankAccountId: src.bankAccountId,
      paymentMethodId: src.paymentMethodId || null,
      notes: src.notes || null,
      importHash,
      reconciled: false,
    },
    select: { id: true },
  });

  revalidatePath("/movimenti");
  revalidatePath("/dashboard");
  return { ok: true, id: created.id };
}

/** Inverte il flag `reconciled` di un singolo movimento. */
export async function toggleReconciled(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const existing = await prisma.transaction.findFirst({
    where: { id, holderId },
    select: { id: true, reconciled: true },
  });
  if (!existing) return { ok: false, error: "Movimento non trovato" };
  const next = !existing.reconciled;
  await prisma.transaction.update({
    where: { id },
    data: {
      reconciled: next,
      reconciledAt: next ? new Date() : null,
    },
  });
  revalidatePath("/movimenti");
  revalidatePath("/dashboard");
  return { ok: true, id };
}

/**
 * Imposta `reconciled` (+ eventuale nota) su più movimenti in un colpo.
 * - Se `note` è una stringa, viene scritta (anche vuota → null).
 * - Se `note` è undefined, la nota non viene toccata.
 */
export async function bulkSetReconciliation(
  ids: string[],
  reconciled: boolean,
  note?: string | null,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { holderId } = await requireHolder();
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: "Nessun movimento selezionato" };
  }
  if (ids.length > 5000) {
    return { ok: false, error: "Troppi movimenti in un singolo aggiornamento" };
  }

  const data: Record<string, unknown> = {
    reconciled,
    reconciledAt: reconciled ? new Date() : null,
  };
  if (note !== undefined) {
    const trimmed = (note ?? "").trim();
    data.reconciliationNote = trimmed.length > 0 ? trimmed.slice(0, 200) : null;
  }

  const r = await prisma.transaction.updateMany({
    where: { id: { in: ids }, holderId },
    data,
  });
  revalidatePath("/movimenti");
  revalidatePath("/dashboard");
  return { ok: true, count: r.count };
}

/** Aggiorna SOLO la nota di riconciliazione (lasciando invariato il flag). */
export async function setReconciliationNote(
  id: string,
  note: string | null,
): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const existing = await prisma.transaction.findFirst({
    where: { id, holderId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Movimento non trovato" };
  const trimmed = (note ?? "").trim();
  await prisma.transaction.update({
    where: { id },
    data: { reconciliationNote: trimmed.length > 0 ? trimmed.slice(0, 200) : null },
  });
  revalidatePath("/movimenti");
  return { ok: true, id };
}

/**
 * Elimina un movimento dell'Intestatario attivo.
 * Se il movimento fa parte di un giroconto (transferGroupId valorizzato),
 * elimina anche il movimento speculare sull'altro conto in transazione
 * atomica. La conferma esplicita "stai per eliminare anche X" è
 * responsabilità della UI (vedi MovimentoDialog).
 */
export async function deleteMovimento(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const existing = await prisma.transaction.findFirst({
    where: { id, holderId },
    select: { id: true, transferGroupId: true },
  });
  if (!existing) return { ok: false, error: "Movimento non trovato" };

  await prisma.$transaction(async (tx) => {
    if (existing.transferGroupId) {
      // Cancella TUTTI i movimenti del gruppo (in pratica self + sibling).
      // Usiamo deleteMany col where sul transferGroupId per fare un solo round-trip.
      await tx.transaction.deleteMany({
        where: { holderId, transferGroupId: existing.transferGroupId },
      });
    } else {
      await tx.transaction.delete({ where: { id } });
    }
  });

  revalidatePath("/movimenti");
  revalidatePath("/dashboard");
  return { ok: true, id };
}
