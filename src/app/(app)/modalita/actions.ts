"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const inputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Nome obbligatorio").max(80),
  notes: z.string().trim().max(300).nullable().optional(),
});

export type ModalitaInput = z.infer<typeof inputSchema>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function requireHolder() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

export async function saveModalita(raw: ModalitaInput): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const parse = inputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  try {
    let savedId: string;
    if (v.id) {
      const existing = await prisma.paymentMethod.findFirst({
        where: { id: v.id, holderId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Modalità non trovata" };
      const updated = await prisma.paymentMethod.update({
        where: { id: v.id },
        data: { name: v.name, notes: v.notes || null },
      });
      savedId = updated.id;
    } else {
      const created = await prisma.paymentMethod.create({
        data: { holderId, name: v.name, notes: v.notes || null },
      });
      savedId = created.id;
    }
    revalidatePath("/modalita");
    revalidatePath("/movimenti");
    return { ok: true, id: savedId };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, error: "Esiste già una modalità con questo nome" };
    }
    return { ok: false, error: "Errore salvataggio: " + (e?.message ?? "sconosciuto") };
  }
}

export async function deleteModalita(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const existing = await prisma.paymentMethod.findFirst({
    where: { id, holderId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Modalità non trovata" };
  // PaymentMethod ha onDelete: SetNull, quindi i movimenti restano (con paymentMethod = null)
  await prisma.paymentMethod.delete({ where: { id } });
  revalidatePath("/modalita");
  revalidatePath("/movimenti");
  return { ok: true, id };
}
