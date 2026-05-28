"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const overrideSchema = z.object({
  categoryId: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(3000),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().min(0).max(99_999_999),
});

const rangeSchema = z.object({
  categoryId: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(3000),
  fromMonth: z.coerce.number().int().min(1).max(12),
  toMonth: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().min(0).max(99_999_999),
});

const monthsSchema = z.object({
  categoryId: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(3000),
  months: z.array(z.coerce.number().int().min(1).max(12)).min(1),
  amount: z.coerce.number().min(0).max(99_999_999),
});

const cellsSchema = z.object({
  categoryId: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(3000),
  cells: z
    .array(
      z.object({
        month: z.coerce.number().int().min(1).max(12),
        amount: z.coerce.number().min(0).max(99_999_999),
      }),
    )
    .min(1),
});

const bulkSchema = z.object({
  year: z.coerce.number().int().min(1900).max(3000),
  cells: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        month: z.coerce.number().int().min(1).max(12),
        amount: z.coerce.number().min(0).max(99_999_999),
      }),
    )
    .min(1),
});

const clearOneSchema = z.object({
  categoryId: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(3000),
  month: z.coerce.number().int().min(1).max(12),
});

const clearYearSchema = z.object({
  categoryId: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(3000),
});

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

async function assertCategoryOwnership(holderId: string, categoryId: string) {
  const cat = await prisma.category.findFirst({
    where: { id: categoryId, holderId },
    select: { id: true },
  });
  if (!cat) throw new Error("Categoria non trovata");
}

function revalidate() {
  revalidatePath("/budget");
  revalidatePath("/dashboard");
  revalidatePath("/categorie");
}

/** Imposta un override per una singola cella (categoria, anno, mese). */
export async function setBudgetOverride(input: z.input<typeof overrideSchema>) {
  const { holderId } = await requireUser();
  const data = overrideSchema.parse(input);
  await assertCategoryOwnership(holderId,data.categoryId);

  await prisma.monthlyBudgetOverride.upsert({
    where: {
      holderId_categoryId_year_month: {
        holderId,
        categoryId: data.categoryId,
        year: data.year,
        month: data.month,
      },
    },
    update: { amount: data.amount },
    create: {
      holderId,
      categoryId: data.categoryId,
      year: data.year,
      month: data.month,
      amount: data.amount,
    },
  });

  revalidate();
  return { ok: true as const };
}

/** Cancella l'override di una singola cella (torna al valore auto-calcolato). */
export async function clearBudgetOverride(input: z.input<typeof clearOneSchema>) {
  const { holderId } = await requireUser();
  const data = clearOneSchema.parse(input);
  await assertCategoryOwnership(holderId,data.categoryId);

  await prisma.monthlyBudgetOverride.deleteMany({
    where: {
      holderId,
      categoryId: data.categoryId,
      year: data.year,
      month: data.month,
    },
  });

  revalidate();
  return { ok: true as const };
}

/**
 * Applica lo stesso valore a tutti i mesi nell'intervallo [fromMonth, toMonth]
 * inclusi (1-12). Usa upsert su ogni mese per non perdere idempotenza.
 */
export async function applyOverrideToRange(input: z.input<typeof rangeSchema>) {
  const { holderId } = await requireUser();
  const data = rangeSchema.parse(input);
  await assertCategoryOwnership(holderId,data.categoryId);

  const start = Math.min(data.fromMonth, data.toMonth);
  const end = Math.max(data.fromMonth, data.toMonth);

  const ops = [];
  for (let m = start; m <= end; m++) {
    ops.push(
      prisma.monthlyBudgetOverride.upsert({
        where: {
          holderId_categoryId_year_month: {
            holderId,
            categoryId: data.categoryId,
            year: data.year,
            month: m,
          },
        },
        update: { amount: data.amount },
        create: {
          holderId,
          categoryId: data.categoryId,
          year: data.year,
          month: m,
          amount: data.amount,
        },
      }),
    );
  }
  await prisma.$transaction(ops);

  revalidate();
  return { ok: true as const, monthsTouched: end - start + 1 };
}

/**
 * Applica lo stesso valore a un set arbitrario di mesi (1-12) per (categoria, anno).
 * Sostituisce eventuali override esistenti per quei mesi (upsert).
 */
export async function applyOverrideToMonths(input: z.input<typeof monthsSchema>) {
  const { holderId } = await requireUser();
  const data = monthsSchema.parse(input);
  await assertCategoryOwnership(holderId,data.categoryId);

  // Deduplica + ordina
  const months = Array.from(new Set(data.months)).sort((a, b) => a - b);

  const ops = months.map((m) =>
    prisma.monthlyBudgetOverride.upsert({
      where: {
        holderId_categoryId_year_month: {
          holderId,
          categoryId: data.categoryId,
          year: data.year,
          month: m,
        },
      },
      update: { amount: data.amount },
      create: {
        holderId,
        categoryId: data.categoryId,
        year: data.year,
        month: m,
        amount: data.amount,
      },
    }),
  );
  await prisma.$transaction(ops);

  revalidate();
  return { ok: true as const, monthsTouched: months.length };
}

/**
 * Applica importi diversi per mese (utile quando il criterio è "consuntivo",
 * "media 3M", ecc.: ogni mese calcolato sul proprio storico). Una sola transaction.
 */
export async function applyOverrideToCells(input: z.input<typeof cellsSchema>) {
  const { holderId } = await requireUser();
  const data = cellsSchema.parse(input);
  await assertCategoryOwnership(holderId,data.categoryId);

  // Deduplica per mese (ultimo vince)
  const byMonth = new Map<number, number>();
  for (const c of data.cells) byMonth.set(c.month, c.amount);

  const ops = Array.from(byMonth.entries()).map(([month, amount]) =>
    prisma.monthlyBudgetOverride.upsert({
      where: {
        holderId_categoryId_year_month: {
          holderId,
          categoryId: data.categoryId,
          year: data.year,
          month,
        },
      },
      update: { amount },
      create: {
        holderId,
        categoryId: data.categoryId,
        year: data.year,
        month,
        amount,
      },
    }),
  );
  await prisma.$transaction(ops);

  revalidate();
  return { ok: true as const, monthsTouched: byMonth.size };
}

/**
 * Applica una mappa di (categoryId, month, amount) in batch. Una sola transaction.
 * Ogni categoria viene verificata in ownership prima dell'upsert.
 */
export async function applyOverridesBulk(input: z.input<typeof bulkSchema>) {
  const { holderId } = await requireUser();
  const data = bulkSchema.parse(input);

  // Verifica ownership di tutte le categorie coinvolte
  const catIds = Array.from(new Set(data.cells.map((c) => c.categoryId)));
  const owned = await prisma.category.findMany({
    where: { holderId, id: { in: catIds } },
    select: { id: true },
  });
  if (owned.length !== catIds.length) {
    return { ok: false as const, error: "Una o più categorie non valide" };
  }

  const ops = data.cells.map((c) =>
    prisma.monthlyBudgetOverride.upsert({
      where: {
        holderId_categoryId_year_month: {
          holderId,
          categoryId: c.categoryId,
          year: data.year,
          month: c.month,
        },
      },
      update: { amount: c.amount },
      create: {
        holderId,
        categoryId: c.categoryId,
        year: data.year,
        month: c.month,
        amount: c.amount,
      },
    }),
  );
  await prisma.$transaction(ops);
  revalidate();
  return { ok: true as const, cellsTouched: data.cells.length };
}

/**
 * Imposta a 0 € il budget di TUTTE le categorie con hasBudget=true per ogni mese
 * dell'anno (12×N upsert in transaction). Utile per partire da una "lavagna pulita"
 * e impostare le voci una per una.
 */
export async function setAllToZeroForYear(year: number) {
  const { holderId } = await requireUser();
  const y = z.coerce.number().int().min(1900).max(3000).parse(year);

  const cats = await prisma.category.findMany({
    where: { holderId, hasBudget: true },
    select: { id: true },
  });
  if (cats.length === 0) {
    return { ok: true as const, cellsTouched: 0 };
  }

  const ops = [];
  for (const c of cats) {
    for (let m = 1; m <= 12; m++) {
      ops.push(
        prisma.monthlyBudgetOverride.upsert({
          where: {
            holderId_categoryId_year_month: {
              holderId,
              categoryId: c.id,
              year: y,
              month: m,
            },
          },
          update: { amount: 0 },
          create: {
            holderId,
            categoryId: c.id,
            year: y,
            month: m,
            amount: 0,
          },
        }),
      );
    }
  }
  await prisma.$transaction(ops);
  revalidate();
  return { ok: true as const, cellsTouched: ops.length };
}

/**
 * Rimuove TUTTI gli override del budget per l'anno (tutte le categorie).
 * Operazione distruttiva: si torna al budget calcolato dalle modalità.
 */
export async function clearAllOverridesForYear(year: number) {
  const { holderId } = await requireUser();
  const y = z.coerce.number().int().min(1900).max(3000).parse(year);
  const res = await prisma.monthlyBudgetOverride.deleteMany({
    where: { holderId, year: y },
  });
  revalidate();
  return { ok: true as const, deleted: res.count };
}

/** Rimuove tutti gli override per (categoria, anno). */
export async function clearOverridesForCategoryYear(
  input: z.input<typeof clearYearSchema>,
) {
  const { holderId } = await requireUser();
  const data = clearYearSchema.parse(input);
  await assertCategoryOwnership(holderId,data.categoryId);

  const res = await prisma.monthlyBudgetOverride.deleteMany({
    where: {
      holderId,
      categoryId: data.categoryId,
      year: data.year,
    },
  });

  revalidate();
  return { ok: true as const, deleted: res.count };
}

/**
 * Comodità: copia il valore auto-calcolato (passato dal client) come override
 * per tutti i mesi dell'anno. Utile per "fissa l'auto del periodo X come budget
 * dell'intero anno".
 */
export async function freezeAutoToYear(input: {
  categoryId: string;
  year: number;
  monthValues: Record<number, number>; // mese 1-12 -> importo
}) {
  const { holderId } = await requireUser();
  await assertCategoryOwnership(holderId,input.categoryId);
  const year = z.coerce.number().int().min(1900).max(3000).parse(input.year);

  const ops = [];
  for (const [mStr, raw] of Object.entries(input.monthValues)) {
    const month = Number(mStr);
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    const amount = Math.max(0, Number(raw) || 0);
    ops.push(
      prisma.monthlyBudgetOverride.upsert({
        where: {
          holderId_categoryId_year_month: {
            holderId,
            categoryId: input.categoryId,
            year,
            month,
          },
        },
        update: { amount },
        create: {
          holderId,
          categoryId: input.categoryId,
          year,
          month,
          amount,
        },
      }),
    );
  }
  if (ops.length) await prisma.$transaction(ops);

  revalidate();
  return { ok: true as const, monthsTouched: ops.length };
}
