import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const HOLDER_COOKIE = "fp_holder_id";

export type ActiveHolder = {
  id: string;
  name: string;
  userId: string;
};

/**
 * Restituisce l'Intestatario (Holder) attivo per l'utente.
 *
 * Priorità di selezione:
 *   1) cookie "fp_holder_id" (se appartiene all'utente)
 *   2) User.activeHolderId (se valido)
 *   3) primo Holder dell'utente in ordine di creazione
 *
 * Self-healing migration: se l'utente non ha nessun Holder, ne viene creato uno
 * chiamato "Stefano" e tutti i record orfani (holderId = null) appartenenti
 * all'utente vengono associati a questo Holder. Operazione one-shot.
 */
export async function getActiveHolder(userId: string): Promise<ActiveHolder> {
  // 1. Trova holders dell'utente
  let holders = await prisma.holder.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, userId: true },
  });

  // 2. Nessun Holder ancora → bootstrap minimo (caso "primo accesso utente nuovo")
  if (holders.length === 0) {
    // Nome derivato dal profilo Google (User.name) o, in fallback, dalla parte
    // locale dell'email (es. "mario.rossi@gmail.com" → "mario.rossi").
    // Mai null/empty: il default ultimo è "Personale".
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const firstName =
      u?.name?.trim().split(/\s+/)[0] ||
      u?.email?.split("@")[0] ||
      "Personale";

    const created = await prisma.$transaction(async (tx) => {
      const h = await tx.holder.create({
        data: { userId, name: firstName },
        select: { id: true, name: true, userId: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: { activeHolderId: h.id },
      });
      return h;
    });
    return created;
  }

  // 3. Cookie?
  const cookieStore = await cookies();
  const cookieId = cookieStore.get(HOLDER_COOKIE)?.value;
  if (cookieId) {
    const match = holders.find((h) => h.id === cookieId);
    if (match) return match;
  }

  // 4. activeHolderId su User?
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeHolderId: true },
  });
  if (user?.activeHolderId) {
    const match = holders.find((h) => h.id === user.activeHolderId);
    if (match) return match;
  }

  // 5. Fallback: primo Holder
  return holders[0];
}

/**
 * Lista tutti gli Holders dell'utente, ordinati per data di creazione.
 * Usato per popolare lo switcher in topbar e la pagina /impostazioni/intestatari.
 */
export async function listHolders(userId: string) {
  return prisma.holder.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      notes: true,
      createdAt: true,
      _count: {
        select: {
          transactions: true,
          bankAccounts: true,
          categories: true,
        },
      },
    },
  });
}

/**
 * Cambia l'Holder attivo: aggiorna cookie + User.activeHolderId.
 * Da chiamare da una server action quando l'utente seleziona dal dropdown.
 */
export async function setActiveHolder(userId: string, holderId: string) {
  // Validazione: l'holderId deve appartenere all'utente
  const h = await prisma.holder.findFirst({
    where: { id: holderId, userId },
    select: { id: true },
  });
  if (!h) throw new Error("Intestatario non valido");

  const cookieStore = await cookies();
  cookieStore.set(HOLDER_COOKIE, holderId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 anno
  });

  await prisma.user.update({
    where: { id: userId },
    data: { activeHolderId: holderId },
  });
}
