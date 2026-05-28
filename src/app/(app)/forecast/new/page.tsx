import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getActiveHolder } from "@/lib/holder";
import { ForecastNewForm } from "@/components/forecast/ForecastNewForm";

export default async function ForecastNewPage(props: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;

  const sp = await props.searchParams;

  // Anni disponibili (dalle transazioni)
  const first = await prisma.transaction.findFirst({
    where: { holderId },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const last = await prisma.transaction.findFirst({
    where: { holderId },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const firstYear = first?.date?.getFullYear() ?? new Date().getFullYear();
  const lastYear = (last?.date?.getFullYear() ?? new Date().getFullYear()) + 1;
  const yearOptions: number[] = [];
  for (let y = lastYear; y >= firstYear; y--) yearOptions.push(y);

  const yearParsed = sp.year ? Number(sp.year) : new Date().getFullYear();
  const initialYear =
    Number.isFinite(yearParsed) && yearOptions.includes(yearParsed)
      ? yearParsed
      : (yearOptions[0] ?? new Date().getFullYear());

  // Mesi con almeno una transazione per l'anno scelto (default check)
  const txInYear = await prisma.transaction.findMany({
    where: {
      holderId,
      date: {
        gte: new Date(initialYear, 0, 1),
        lt: new Date(initialYear + 1, 0, 1),
      },
    },
    select: { date: true },
  });
  const monthsWithTx = new Set<number>();
  for (const t of txInYear) monthsWithTx.add(t.date.getMonth() + 1);
  // Default suggerito: mesi con transazioni AND <= mese corrente (se anno corrente)
  const now = new Date();
  const defaultActual: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const inPast =
      initialYear < now.getFullYear() ||
      (initialYear === now.getFullYear() && m <= now.getMonth() + 1);
    if (monthsWithTx.has(m) && inPast) defaultActual.push(m);
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <div className="text-xs text-sub">Pianificazione · Forecast</div>
        <h1 className="text-xl font-semibold tracking-tight">Nuovo scenario</h1>
      </div>

      <ForecastNewForm
        yearOptions={yearOptions}
        initialYear={initialYear}
        initialActualMonths={defaultActual}
        monthsWithTx={Array.from(monthsWithTx).sort((a, b) => a - b)}
      />
    </div>
  );
}
