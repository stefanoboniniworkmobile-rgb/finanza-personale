"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BUDGET_MODES } from "@/lib/budget";

const inputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Nome obbligatorio").max(80),
  type: z.enum(["income", "expense"]),
  showInDashboard: z.boolean(),
  hasBudget: z.boolean(),
  budgetMode: z.enum(BUDGET_MODES as unknown as [string, ...string[]]),
  manualBudget: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  // Causale di trasferimento tra conti — vedi commento in schema.prisma.
  // Se isTransfer=true, in fase di inserimento del movimento la UI mostra
  // anche la select "Conto di contropartita".
  isTransfer: z.boolean().optional().default(false),
  // ID di un'altra Category dell'Holder da usare come causale speculare
  // sull'altro lato del giroconto. Opzionale: se omessa si userà la
  // stessa Category anche dall'altro lato.
  counterpartCategoryId: z.string().trim().min(1).nullable().optional(),
});

export type CategoriaInput = z.infer<typeof inputSchema>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function requireHolder() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

export async function saveCategoria(raw: CategoriaInput): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const parse = inputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  // Manuale richiede importo
  if (v.budgetMode === "MANUAL" && (v.manualBudget == null || v.manualBudget <= 0)) {
    return {
      ok: false,
      error: "Modalità Manuale richiede un importo > 0",
    };
  }
  // Se mode != MANUAL, manualBudget viene azzerato
  const manualBudget = v.budgetMode === "MANUAL" ? v.manualBudget ?? 0 : null;

  // Trasferimento: validazione contropartita.
  // Regole:
  //  - Se isTransfer=false → forziamo counterpartCategoryId a null (la
  //    contropartita ha senso solo per causali di trasferimento).
  //  - Se isTransfer=true e counterpartCategoryId valorizzato →
  //      a) deve esistere e appartenere allo stesso Holder
  //      b) deve essere diversa dalla categoria che stiamo salvando
  //      c) idealmente è di tipo opposto, ma NON lo enforce (l'utente
  //         potrebbe avere convenzioni personali; mostriamo solo warning UI).
  const isTransfer = v.isTransfer ?? false;
  let counterpartCategoryId: string | null = isTransfer
    ? (v.counterpartCategoryId ?? null)
    : null;
  if (isTransfer && counterpartCategoryId) {
    if (v.id && counterpartCategoryId === v.id) {
      return { ok: false, error: "La contropartita non può essere la categoria stessa" };
    }
    const other = await prisma.category.findFirst({
      where: { id: counterpartCategoryId, holderId },
      select: { id: true },
    });
    if (!other) {
      return { ok: false, error: "Categoria di contropartita non trovata" };
    }
  }

  try {
    let savedId: string;
    if (v.id) {
      const existing = await prisma.category.findFirst({
        where: { id: v.id, holderId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Categoria non trovata" };
      const updated = await prisma.category.update({
        where: { id: v.id },
        data: {
          name: v.name,
          type: v.type,
          showInDashboard: v.showInDashboard,
          hasBudget: v.hasBudget,
          budgetMode: v.budgetMode,
          manualBudget,
          isTransfer,
          counterpartCategoryId,
        },
      });
      savedId = updated.id;
    } else {
      const created = await prisma.category.create({
        data: {
          holderId,
          name: v.name,
          type: v.type,
          showInDashboard: v.showInDashboard,
          hasBudget: v.hasBudget,
          budgetMode: v.budgetMode,
          manualBudget,
          isTransfer,
          counterpartCategoryId,
        },
      });
      savedId = created.id;
    }
    revalidatePath("/categorie");
    revalidatePath("/dashboard");
    revalidatePath("/movimenti");
    return { ok: true, id: savedId };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, error: "Esiste già una categoria con questo nome" };
    }
    return { ok: false, error: "Errore salvataggio: " + (e?.message ?? "sconosciuto") };
  }
}

export async function deleteCategoria(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const cat = await prisma.category.findFirst({
    where: { id, holderId },
    include: { _count: { select: { transactions: true } } },
  });
  if (!cat) return { ok: false, error: "Categoria non trovata" };
  if (cat._count.transactions > 0) {
    return {
      ok: false,
      error: `Non eliminabile: ci sono ${cat._count.transactions} movimenti collegati. Riassegnali prima di eliminare.`,
    };
  }
  await prisma.category.delete({ where: { id } });
  revalidatePath("/categorie");
  revalidatePath("/dashboard");
  revalidatePath("/movimenti");
  return { ok: true, id };
}

/** Update veloce della modalità budget (senza dialog). */
export async function updateBudgetMode(
  id: string,
  mode: string,
): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  if (!BUDGET_MODES.includes(mode as any)) {
    return { ok: false, error: "Modalità non valida" };
  }
  const existing = await prisma.category.findFirst({
    where: { id, holderId },
    select: { id: true, manualBudget: true },
  });
  if (!existing) return { ok: false, error: "Categoria non trovata" };
  await prisma.category.update({
    where: { id },
    data: {
      budgetMode: mode,
      // Se passo a non-MANUAL, azzero l'importo manuale
      manualBudget: mode === "MANUAL" ? existing.manualBudget : null,
    },
  });
  revalidatePath("/categorie");
  revalidatePath("/dashboard");
  return { ok: true, id };
}

/** Toggle veloce di hasBudget. */
export async function toggleHasBudget(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const existing = await prisma.category.findFirst({
    where: { id, holderId },
    select: { id: true, hasBudget: true },
  });
  if (!existing) return { ok: false, error: "Categoria non trovata" };
  await prisma.category.update({
    where: { id },
    data: { hasBudget: !existing.hasBudget },
  });
  revalidatePath("/categorie");
  revalidatePath("/dashboard");
  return { ok: true, id };
}
