import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveHolder, listHolders } from "@/lib/holder";
import { IntestatariClient } from "@/components/intestatari/IntestatariClient";

export default async function IntestatariPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id!;

  const [holders, active] = await Promise.all([
    listHolders(userId),
    getActiveHolder(userId),
  ]);

  const rows = holders.map((h) => ({
    id: h.id,
    name: h.name,
    notes: h.notes,
    txCount: h._count.transactions,
    accountCount: h._count.bankAccounts,
    categoryCount: h._count.categories,
    isActive: h.id === active.id,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">
            <Link href="/impostazioni" className="hover:underline">
              Impostazioni
            </Link>{" "}
            / Intestatari
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Intestatari</h1>
        </div>
        <div className="text-xs text-sub">{rows.length} intestatari</div>
      </div>

      <div className="panel p-4 mb-4 text-xs text-sub leading-relaxed">
        <span className="font-medium text-ink">Come funziona.</span> Ogni
        intestatario è un perimetro di dati separato: conti, categorie, budget e
        movimenti vivono dentro un singolo intestatario. Quando cambi
        intestatario dalla topbar, tutta l'app si filtra di conseguenza. Niente
        è condiviso tra intestatari diversi.
      </div>

      <IntestatariClient rows={rows} />
    </div>
  );
}
