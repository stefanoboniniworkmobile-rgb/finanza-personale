"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { csvFromMonthArr } from "@/lib/forecast";

const monthArr = z.array(z.coerce.number().int().min(1).max(12));

const createSchema = z.object({
  name: z.string().trim().min(1, "Nome obbligatorio").max(80),
  year: z.coerce.number().int().min(1900).max(3000),
  actualMonths: monthArr,
  notes: z.string().max(500).optional(),
});

const updateSettingsSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  year: z.coerce.number().int().min(1900).max(3000),
  actualMonths: monthArr,
  notes: z.string().max(500).optional(),
});

const cellSchema = z.object({
  forecastId: z.string().min(1),
  categoryId: z.string().min(1),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().min(0).max(99_999_999),
});

const cellRangeSchema = z.object({
  forecastId: z.string().min(1),
  categoryId: z.string().min(1),
  fromMonth: z.coerce.number().int().min(1).max(12),
  toMonth: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().min(0).max(99_999_999),
});

const cellMonthsSchema = z.object({
  forecastId: z.string().min(1),
  categoryId: z.string().min(1),
  months: z.array(z.coerce.number().int().min(1).max(12)).min(1),
  amount: z.coerce.number().min(0).max(99_999_999),
});

const cellsValuesSchema = z.object({
  forecastId: z.string().min(1),
  categoryId: z.string().min(1),
  cells: z
    .array(
      z.object({
        month: z.coerce.number().int().min(1).max(12),
        amount: z.coerce.number().min(0).max(99_999_999),
      }),
    )
    .min(1),
});

const bulkForecastSchema = z.object({
  forecastId: z.string().min(1),
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

const cellClearSchema = z.object({
  forecastId: z.string().min(1),
  categoryId: z.string().min(1),
  month: z.coerce.number().int().min(1).max(12),
});

const rowResetSchema = z.object({
  forecastId: z.string().min(1),
  categoryId: z.string().min(1),
});

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Non autenticato");
  const holder = await getActiveHolder(session.user.id);
  return { holderId: holder.id };
}

async function assertForecastOwner(holderId: string, forecastId: string) {
  const f = await prisma.forecast.findFirst({
    where: { id: forecastId, holderId },
    select: { id: true },
  });
  if (!f) throw new Error("Forecast non trovato");
}

function revalidate(id?: string) {
  revalidatePath("/forecast");
  if (id) revalidatePath(`/forecast/${id}`);
}

/** Crea un nuovo scenario. Se `redirectAfter` è true, redirige alla pagina dello scenario. */
export async function createForecast(
  raw: z.input<typeof createSchema>,
  opts?: { redirectAfter?: boolean },
) {
  const { holderId } = await requireUser();
  const data = createSchema.parse(raw);
  let createdId: string;
  try {
    const created = await prisma.forecast.create({
      data: {
        holderId,
        name: data.name,
        year: data.year,
        actualMonths: csvFromMonthArr(data.actualMonths),
        notes: data.notes ?? null,
      },
      select: { id: true },
    });
    createdId = created.id;
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false as const, error: "Esiste già uno scenario con questo nome per l'anno scelto" };
    }
    return { ok: false as const, error: "Errore nel salvataggio: " + (e?.message ?? "?") };
  }
  revalidate(createdId);
  if (opts?.redirectAfter) {
    redirect(`/forecast/${createdId}`);
  }
  return { ok: true as const, id: createdId };
}

export async function updateForecastSettings(raw: z.input<typeof updateSettingsSchema>) {
  const { holderId } = await requireUser();
  const data = updateSettingsSchema.parse(raw);
  await assertForecastOwner(holderId,data.id);
  try {
    await prisma.forecast.update({
      where: { id: data.id },
      data: {
        name: data.name,
        year: data.year,
        actualMonths: csvFromMonthArr(data.actualMonths),
        notes: data.notes ?? null,
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false as const, error: "Esiste già uno scenario con questo nome per l'anno scelto" };
    }
    return { ok: false as const, error: "Errore nel salvataggio: " + (e?.message ?? "?") };
  }
  revalidate(data.id);
  return { ok: true as const };
}

export async function deleteForecast(id: string) {
  const { holderId } = await requireUser();
  await assertForecastOwner(holderId,id);
  await prisma.forecast.delete({ where: { id } });
  revalidatePath("/forecast");
  return { ok: true as const };
}

/** Imposta il valore di una cella budget (categoria × mese) all'interno del forecast. */
export async function setForecastBudget(raw: z.input<typeof cellSchema>) {
  const { holderId } = await requireUser();
  const data = cellSchema.parse(raw);
  await assertForecastOwner(holderId,data.forecastId);
  // Verifica ownership categoria
  const cat = await prisma.category.findFirst({
    where: { id: data.categoryId, holderId },
    select: { id: true },
  });
  if (!cat) throw new Error("Categoria non trovata");

  await prisma.forecastBudget.upsert({
    where: {
      forecastId_categoryId_month: {
        forecastId: data.forecastId,
        categoryId: data.categoryId,
        month: data.month,
      },
    },
    update: { amount: data.amount },
    create: {
      forecastId: data.forecastId,
      categoryId: data.categoryId,
      month: data.month,
      amount: data.amount,
    },
  });
  revalidate(data.forecastId);
  return { ok: true as const };
}

export async function clearForecastBudget(raw: z.input<typeof cellClearSchema>) {
  const { holderId } = await requireUser();
  const data = cellClearSchema.parse(raw);
  await assertForecastOwner(holderId,data.forecastId);
  await prisma.forecastBudget.deleteMany({
    where: {
      forecastId: data.forecastId,
      categoryId: data.categoryId,
      month: data.month,
    },
  });
  revalidate(data.forecastId);
  return { ok: true as const };
}

export async function applyForecastBudgetRange(raw: z.input<typeof cellRangeSchema>) {
  const { holderId } = await requireUser();
  const data = cellRangeSchema.parse(raw);
  await assertForecastOwner(holderId,data.forecastId);
  const cat = await prisma.category.findFirst({
    where: { id: data.categoryId, holderId },
    select: { id: true },
  });
  if (!cat) throw new Error("Categoria non trovata");

  const start = Math.min(data.fromMonth, data.toMonth);
  const end = Math.max(data.fromMonth, data.toMonth);
  const ops = [];
  for (let m = start; m <= end; m++) {
    ops.push(
      prisma.forecastBudget.upsert({
        where: {
          forecastId_categoryId_month: {
            forecastId: data.forecastId,
            categoryId: data.categoryId,
            month: m,
          },
        },
        update: { amount: data.amount },
        create: {
          forecastId: data.forecastId,
          categoryId: data.categoryId,
          month: m,
          amount: data.amount,
        },
      }),
    );
  }
  await prisma.$transaction(ops);
  revalidate(data.forecastId);
  return { ok: true as const, monthsTouched: end - start + 1 };
}

/** Applica lo stesso valore a un set arbitrario di mesi nel forecast. */
export async function applyForecastBudgetToMonths(
  raw: z.input<typeof cellMonthsSchema>,
) {
  const { holderId } = await requireUser();
  const data = cellMonthsSchema.parse(raw);
  await assertForecastOwner(holderId,data.forecastId);
  const cat = await prisma.category.findFirst({
    where: { id: data.categoryId, holderId },
    select: { id: true },
  });
  if (!cat) throw new Error("Categoria non trovata");

  const months = Array.from(new Set(data.months)).sort((a, b) => a - b);
  const ops = months.map((m) =>
    prisma.forecastBudget.upsert({
      where: {
        forecastId_categoryId_month: {
          forecastId: data.forecastId,
          categoryId: data.categoryId,
          month: m,
        },
      },
      update: { amount: data.amount },
      create: {
        forecastId: data.forecastId,
        categoryId: data.categoryId,
        month: m,
        amount: data.amount,
      },
    }),
  );
  await prisma.$transaction(ops);
  revalidate(data.forecastId);
  return { ok: true as const, monthsTouched: months.length };
}

/** Applica importi diversi per mese nel forecast (per criteri "consuntivo", "media 3M" ecc.). */
export async function applyForecastBudgetToCells(
  raw: z.input<typeof cellsValuesSchema>,
) {
  const { holderId } = await requireUser();
  const data = cellsValuesSchema.parse(raw);
  await assertForecastOwner(holderId,data.forecastId);
  const cat = await prisma.category.findFirst({
    where: { id: data.categoryId, holderId },
    select: { id: true },
  });
  if (!cat) throw new Error("Categoria non trovata");

  const byMonth = new Map<number, number>();
  for (const c of data.cells) byMonth.set(c.month, c.amount);

  const ops = Array.from(byMonth.entries()).map(([month, amount]) =>
    prisma.forecastBudget.upsert({
      where: {
        forecastId_categoryId_month: {
          forecastId: data.forecastId,
          categoryId: data.categoryId,
          month,
        },
      },
      update: { amount },
      create: {
        forecastId: data.forecastId,
        categoryId: data.categoryId,
        month,
        amount,
      },
    }),
  );
  await prisma.$transaction(ops);
  revalidate(data.forecastId);
  return { ok: true as const, monthsTouched: byMonth.size };
}

/** Applica in batch override forecast per N categorie e mesi. */
export async function applyForecastBudgetsBulk(
  raw: z.input<typeof bulkForecastSchema>,
) {
  const { holderId } = await requireUser();
  const data = bulkForecastSchema.parse(raw);
  await assertForecastOwner(holderId,data.forecastId);

  const catIds = Array.from(new Set(data.cells.map((c) => c.categoryId)));
  const owned = await prisma.category.findMany({
    where: { holderId, id: { in: catIds } },
    select: { id: true },
  });
  if (owned.length !== catIds.length) {
    return { ok: false as const, error: "Una o più categorie non valide" };
  }

  const ops = data.cells.map((c) =>
    prisma.forecastBudget.upsert({
      where: {
        forecastId_categoryId_month: {
          forecastId: data.forecastId,
          categoryId: c.categoryId,
          month: c.month,
        },
      },
      update: { amount: c.amount },
      create: {
        forecastId: data.forecastId,
        categoryId: c.categoryId,
        month: c.month,
        amount: c.amount,
      },
    }),
  );
  await prisma.$transaction(ops);
  revalidate(data.forecastId);
  return { ok: true as const, cellsTouched: data.cells.length };
}

/** Cancella tutti gli override budget di una categoria nello scenario (riga). */
export async function resetForecastRow(raw: z.input<typeof rowResetSchema>) {
  const { holderId } = await requireUser();
  const data = rowResetSchema.parse(raw);
  await assertForecastOwner(holderId,data.forecastId);
  const res = await prisma.forecastBudget.deleteMany({
    where: { forecastId: data.forecastId, categoryId: data.categoryId },
  });
  revalidate(data.forecastId);
  return { ok: true as const, deleted: res.count };
}

/** Duplica uno scenario (nome → "Nome (copia)"). */
export async function duplicateForecast(id: string) {
  const { holderId } = await requireUser();
  const src = await prisma.forecast.findFirst({
    where: { id, holderId },
    include: { budgets: true },
  });
  if (!src) return { ok: false as const, error: "Forecast non trovato" };

  // Trovo un nome non collidente
  let base = `${src.name} (copia)`;
  let candidate = base;
  let n = 1;
  while (
    await prisma.forecast.findFirst({
      where: { holderId, name: candidate, year: src.year },
      select: { id: true },
    })
  ) {
    n++;
    candidate = `${base} ${n}`;
  }
  const dup = await prisma.forecast.create({
    data: {
      holderId,
      name: candidate,
      year: src.year,
      actualMonths: src.actualMonths,
      notes: src.notes,
      budgets: {
        create: src.budgets.map((b) => ({
          categoryId: b.categoryId,
          month: b.month,
          amount: b.amount,
        })),
      },
    },
    select: { id: true },
  });
  revalidatePath("/forecast");
  return { ok: true as const, id: dup.id };
}
