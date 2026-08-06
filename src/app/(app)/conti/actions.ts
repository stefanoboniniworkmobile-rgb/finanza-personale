"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ACCOUNT_TYPES = ["liquidity", "credit_card", "savings", "cash"] as const;

// IBAN: 2 lettere paese + 2 cifre check + fino a 30 char alfanumerici (IT max 27)
// Tolleriamo lunghezze 15..34 perché esistono IBAN più corti (es. NO, BE)
const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

const inputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Nome obbligatorio").max(80),
  type: z.enum(ACCOUNT_TYPES),
  initialBalance: z.coerce.number().min(-1_000_000).max(10_000_000),
  notes: z.string().trim().max(300).nullable().optional(),
  // Istituto/banca per raggruppamento. Campo libero opzionale.
  bank: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  // Normalizzato uppercase senza spazi prima di validare la regex.
  iban: z
    .string()
    .trim()
    .max(40)
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || IBAN_RE.test(v), {
      message: "IBAN non valido (es. IT60X0542811101000000123456)",
    })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  // PAN mascherato così com'è (es. "5189********6765"). Validazione minima: tra 8 e 25 char.
  cardMaskedPan: z
    .string()
    .trim()
    .max(25)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
});

export type ContoInput = z.infer<typeof inputSchema>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

async function requireHolder() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

export async function saveConto(raw: ContoInput): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const parse = inputSchema.safeParse(raw);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Dati non validi" };
  }
  const v = parse.data;

  try {
    let savedId: string;
    if (v.id) {
      const existing = await prisma.bankAccount.findFirst({
        where: { id: v.id, holderId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Conto non trovato" };
      const updated = await prisma.bankAccount.update({
        where: { id: v.id },
        data: {
          name: v.name,
          type: v.type,
          initialBalance: v.initialBalance,
          notes: v.notes || null,
          bank: v.bank ?? null,
          iban: v.iban ?? null,
          cardMaskedPan: v.cardMaskedPan ?? null,
        },
      });
      savedId = updated.id;
    } else {
      const created = await prisma.bankAccount.create({
        data: {
          holderId,
          name: v.name,
          type: v.type,
          initialBalance: v.initialBalance,
          notes: v.notes || null,
          bank: v.bank ?? null,
          iban: v.iban ?? null,
          cardMaskedPan: v.cardMaskedPan ?? null,
        },
      });
      savedId = created.id;
    }
    revalidatePath("/conti");
    revalidatePath("/dashboard");
    revalidatePath("/movimenti");
    return { ok: true, id: savedId };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, error: "Esiste già un conto con questo nome" };
    }
    return { ok: false, error: "Errore salvataggio: " + (e?.message ?? "sconosciuto") };
  }
}

export async function deleteConto(id: string): Promise<ActionResult> {
  const { holderId } = await requireHolder();
  const acc = await prisma.bankAccount.findFirst({
    where: { id, holderId },
    include: { _count: { select: { transactions: true } } },
  });
  if (!acc) return { ok: false, error: "Conto non trovato" };
  if (acc._count.transactions > 0) {
    return {
      ok: false,
      error: `Non eliminabile: ci sono ${acc._count.transactions} movimenti collegati. Riassegnali prima di eliminare.`,
    };
  }
  await prisma.bankAccount.delete({ where: { id } });
  revalidatePath("/conti");
  revalidatePath("/dashboard");
  return { ok: true, id };
}
