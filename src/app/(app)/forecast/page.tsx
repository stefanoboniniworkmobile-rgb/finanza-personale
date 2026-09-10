import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtDateFull } from "@/lib/format";
import { getActiveHolder } from "@/lib/holder";
import { ForecastListActions } from "@/components/forecast/ForecastListActions";
import { parseActualMonths } from "@/lib/forecast";

const MONTHS_SHORT = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

export default async function ForecastListPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);

  const forecasts = await prisma.forecast.findMany({
    where: { holderId: holder.id },
    orderBy: [{ year: "desc" }, { updatedAt: "desc" }],
    include: { _count: { select: { budgets: true } } },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Pianificazione</div>
          <h1 className="text-xl font-semibold tracking-tight">Forecast</h1>
        </div>
        <Link href="/forecast/new" className="btn">
          + Nuovo scenario
        </Link>
      </div>

      <div className="panel p-4 mb-4 text-xs text-sub leading-relaxed">
        <div className="font-medium text-ink mb-1">Cos'è un forecast</div>
        Uno scenario di forecast unisce <strong>consuntivo</strong> per i mesi già
        chiusi e <strong>budget</strong> per i mesi aperti. Ti dice dove finirai
        l'anno date le spese reali fino ad oggi e i piani per il futuro. Puoi
        creare più scenari (base, ottimista, pessimista) e modificare le celle dei
        mesi "budget" senza intaccare la tua pianificazione di /budget.
      </div>

      {forecasts.length === 0 ? (
        <div className="panel p-12 text-center text-sub">
          Nessuno scenario creato. Inizia con{" "}
          <Link href="/forecast/new" className="text-brand-500 hover:underline">
            + Nuovo scenario
          </Link>
          .
        </div>
      ) : (
        <>
        {/* Mobile: scenari a schede */}
        <div className="md:hidden space-y-2.5">
          {forecasts.map((f) => {
            const actuals = parseActualMonths(f.actualMonths);
            return (
              <div key={f.id} className="panel p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/forecast/${f.id}`}
                    className="min-w-0 flex-1 hover:text-brand-500 transition"
                  >
                    <div className="font-semibold text-[15px] truncate">
                      {f.name}
                    </div>
                    {f.notes && (
                      <div className="text-[11px] text-sub truncate">
                        {f.notes}
                      </div>
                    )}
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="pill bg-line2 text-ink2 num-mono">
                      {f.year}
                    </span>
                    <ForecastListActions id={f.id} name={f.name} />
                  </div>
                </div>
                <Link
                  href={`/forecast/${f.id}`}
                  className="mt-2.5 flex items-center gap-2 text-[11px] text-sub"
                >
                  <span>Consuntivo {actuals.length}/12</span>
                  <span>·</span>
                  <span>{f._count.budgets} override</span>
                  <span className="ml-auto num-mono">
                    {fmtDateFull(f.updatedAt)}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>

        {/* Desktop: tabella */}
        <div className="panel overflow-x-auto hidden md:block">
          <table className="dense">
            <thead>
              <tr>
                <th>Nome</th>
                <th style={{ width: 70 }}>Anno</th>
                <th>Mesi consuntivo</th>
                <th className="text-right" style={{ width: 90 }}>
                  Override
                </th>
                <th className="text-right" style={{ width: 130 }}>
                  Aggiornato
                </th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {forecasts.map((f) => {
                const actuals = parseActualMonths(f.actualMonths);
                const actualsLabel =
                  actuals.length === 0
                    ? "—"
                    : actuals.length === 12
                      ? "Tutto consuntivo"
                      : actuals.map((m) => MONTHS_SHORT[m - 1]).join(", ");
                return (
                  <tr key={f.id} className="row">
                    <td className="font-medium">
                      <Link
                        href={`/forecast/${f.id}`}
                        className="hover:text-brand-500 transition"
                      >
                        {f.name}
                      </Link>
                      {f.notes && (
                        <div className="text-xs text-sub truncate max-w-[420px]">
                          {f.notes}
                        </div>
                      )}
                    </td>
                    <td className="num-mono">{f.year}</td>
                    <td className="text-sub text-xs">
                      <span className="truncate inline-block max-w-[440px] align-middle">
                        {actualsLabel}
                      </span>
                      <span className="text-[10px] text-sub ml-1">
                        ({actuals.length}/12)
                      </span>
                    </td>
                    <td className="text-right num-mono text-sub">
                      {f._count.budgets}
                    </td>
                    <td className="text-right num-mono text-sub">
                      {fmtDateFull(f.updatedAt)}
                    </td>
                    <td className="text-right">
                      <ForecastListActions id={f.id} name={f.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
