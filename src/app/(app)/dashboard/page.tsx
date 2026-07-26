import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { loadDashboard, pickDefaultPeriod } from "@/lib/dashboard";
import { getActiveHolder } from "@/lib/holder";
import { fmtPeriodLabel, parsePeriod, shiftYm, ymKey } from "@/lib/format";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { AccountsTable } from "@/components/dashboard/AccountsTable";
import { MonthlyTrendChart } from "@/components/dashboard/MonthlyTrendChart";
import { CategoriesDonut } from "@/components/dashboard/CategoriesDonut";
import { BudgetPanel } from "@/components/dashboard/BudgetPanel";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";

type SearchParams = Promise<{
  period?: string;
  from?: string;
  to?: string;
  bt?: "income" | "expense";
}>;

export default async function DashboardPage(props: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);

  const sp = await props.searchParams;

  // Risolve il periodo:
  //  - se from/to → range
  //  - se period contiene ".." → range
  //  - se period → mese singolo
  //  - altrimenti → default (mese corrente con dati, o ultimo con dati)
  let period: string;
  if (sp.from && sp.to) {
    period = `${sp.from}..${sp.to}`;
  } else if (sp.period) {
    period = sp.period;
  } else {
    period = await pickDefaultPeriod(holder.id);
  }

  const { from: pFrom, to: pTo } = parsePeriod(period);
  const data = await loadDashboard(holder.id, period);
  const budgetTab = sp.bt ?? "expense";

  // Opzioni mesi: ultimi 24 mesi a partire da oggi
  const todayYm = ymKey(new Date());
  const opts: string[] = [];
  for (let i = 0; i < 24; i++) opts.push(shiftYm(todayYm, i));
  if (!opts.includes(pFrom)) opts.push(pFrom);
  if (!opts.includes(pTo)) opts.push(pTo);
  opts.sort((a, b) => b.localeCompare(a)); // dal più recente

  if (!data.hasAnyData) {
    return (
      <div>
        <PageHeader pFrom={pFrom} pTo={pTo} todayYm={todayYm} options={opts} />
        <div className="panel p-8 text-center">
          <div className="text-base font-semibold mb-1">Workspace vuoto</div>
          <p className="text-sm text-sub mb-4">
            Importa il tuo file <code>registro_spese.xlsm</code> dalla CLI o
            crea conti, categorie e movimenti a mano.
          </p>
          <a href="/impostazioni" className="btn">
            Vai a Impostazioni
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader pFrom={pFrom} pTo={pTo} todayYm={todayYm} options={opts} />

      <KpiStrip data={data} />

      <DashboardTabs
        panoramica={
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-8">
              <MonthlyTrendChart data={data.trend} />
            </div>
            <div className="col-span-4">
              <CategoriesDonut
                slices={data.topCategories}
                totalUscite={data.kpi.uscitePeriod}
                period={period}
              />
            </div>
          </div>
        }
        conti={
          <AccountsTable
            accounts={data.accounts}
            totalCount={data.kpi.movimentiTotal}
          />
        }
        budget={
          <BudgetPanel rows={data.budgetRows} period={period} tab={budgetTab} />
        }
        movimenti={<RecentTransactions rows={data.recent} />}
      />
    </div>
  );
}

function PageHeader({
  pFrom,
  pTo,
  todayYm,
  options,
}: {
  pFrom: string;
  pTo: string;
  todayYm: string;
  options: string[];
}) {
  return (
    <div className="flex items-center justify-between mb-4 gap-4">
      <div>
        <div className="text-xs text-sub">Dashboard</div>
        <h1 className="text-xl font-semibold tracking-tight">
          {fmtPeriodLabel(pFrom, pTo)}
        </h1>
      </div>
      <PeriodSelector from={pFrom} to={pTo} todayYm={todayYm} options={options} />
    </div>
  );
}
