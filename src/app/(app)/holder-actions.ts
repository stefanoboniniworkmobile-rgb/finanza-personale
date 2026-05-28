"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { setActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type HolderResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string };

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  return session.user.id;
}

/** Cambia l'Intestatario attivo (cookie + User.activeHolderId), poi revalida tutto. */
export async function switchHolder(holderId: string): Promise<HolderResult> {
  const userId = await requireUserId();
  try {
    await setActiveHolder(userId, holderId);
    const h = await prisma.holder.findUnique({
      where: { id: holderId },
      select: { id: true, name: true },
    });
    // Revalidate ovunque: il cambio di scope tocca tutti i dati
    revalidatePath("/", "layout");
    return { ok: true, id: h!.id, name: h!.name };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Errore" };
  }
}

const inputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Nome obbligatorio").max(80),
  notes: z.string().trim().max(300).nullable().optional(),
});

export type HolderInput = z.infer<typeof inputSchema>;

/** Crea o aggiorna un Intestatario. */
export async function saveHolder(raw: HolderInput): Promise<HolderResult> {
  const userId = await requireUserId();
  const parse = inputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  try {
    let savedId: string;
    let savedName: string;
    if (v.id) {
      const existing = await prisma.holder.findFirst({
        where: { id: v.id, userId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Intestatario non trovato" };
      const updated = await prisma.holder.update({
        where: { id: v.id },
        data: { name: v.name, notes: v.notes || null },
      });
      savedId = updated.id;
      savedName = updated.name;
    } else {
      const created = await prisma.holder.create({
        data: { userId, name: v.name, notes: v.notes || null },
      });
      savedId = created.id;
      savedName = created.name;
    }
    revalidatePath("/impostazioni/intestatari");
    revalidatePath("/", "layout");
    return { ok: true, id: savedId, name: savedName };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, error: "Esiste già un intestatario con questo nome" };
    }
    return { ok: false, error: "Errore salvataggio: " + (e?.message ?? "sconosciuto") };
  }
}

/**
 * Elimina un Intestatario.
 * Vincoli sempre attivi:
 *  - deve esistere ed appartenere all'utente
 *  - non può essere l'unico intestatario dell'utente
 *
 * Modalità:
 *  - `force = false` (default, "soft"): blocca se l'intestatario ha movimenti, conti o categorie.
 *    Pensato per il caso "ho creato Lorenzo per sbaglio, è ancora vuoto, lo butto".
 *  - `force = true` ("hard delete"): salta i controlli su dati collegati. Il Cascade del DB
 *    si occupa di portarsi via in un colpo solo conti, categorie, modalità, movimenti,
 *    budget, forecast, template di import, mapping, batch. Operazione IRREVERSIBILE.
 *
 * La conferma "digita il nome" è gestita lato UI, non qui.
 */
export async function deleteHolder(
  id: string,
  opts?: { force?: boolean },
): Promise<HolderResult & { deleted?: { transactions: number; bankAccounts: number; categories: number } }> {
  const userId = await requireUserId();
  const force = opts?.force === true;

  const h = await prisma.holder.findFirst({
    where: { id, userId },
    include: {
      _count: { select: { transactions: true, bankAccounts: true, categories: true } },
    },
  });
  if (!h) return { ok: false, error: "Intestatario non trovato" };

  // Vincolo invariante: non posso lasciare l'utente senza nessun intestatario
  const totalHolders = await prisma.holder.count({ where: { userId } });
  if (totalHolders <= 1) {
    return {
      ok: false,
      error: "Non puoi eliminare l'unico intestatario. Creane prima un altro.",
    };
  }

  if (!force) {
    if (h._count.transactions > 0) {
      return {
        ok: false,
        error: `Non eliminabile: ci sono ${h._count.transactions} movimenti collegati. Usa "Elimina con tutti i dati" per cancellare anche quelli, oppure svuota l'intestatario prima.`,
      };
    }
    if (h._count.bankAccounts > 0 || h._count.categories > 0) {
      return {
        ok: false,
        error: `Non eliminabile: ci sono ${h._count.bankAccounts} conti e ${h._count.categories} categorie collegate. Usa "Elimina con tutti i dati" per cancellare anche quelli.`,
      };
    }
  }

  // I record figli vengono cancellati in cascade via onDelete: Cascade su Holder
  await prisma.holder.delete({ where: { id } });

  // Se era l'holder attivo, lo deseleziono — il prossimo getActiveHolder sceglierà un altro
  await prisma.user.updateMany({
    where: { id: userId, activeHolderId: id },
    data: { activeHolderId: null },
  });

  revalidatePath("/impostazioni/intestatari");
  revalidatePath("/", "layout");
  return {
    ok: true,
    id: h.id,
    name: h.name,
    deleted: {
      transactions: h._count.transactions,
      bankAccounts: h._count.bankAccounts,
      categories: h._count.categories,
    },
  };
}
