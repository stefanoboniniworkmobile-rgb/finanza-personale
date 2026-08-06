import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getActiveHolder } from "@/lib/holder";
import { ContiClient, type ContoRow } from "@/components/conti/ContiClient";

export default async function ContiPage(props: { searchParams: Promise<{ type?: "all" | "liquidity" | "credit_card" | "savings" | "cash" }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;
  const sp = await props.searchParams;
  const type = sp.type ?? "all";

  const accounts = await prisma.bankAccount.findMany({
    where: type === "all" ? { holderId } : { holderId, type },
    include: { _count: { select: { transactions: true } } },
    orderBy: [{ bank: "asc" }, { name: "asc" }],
  });

  // Calcolo saldo attuale = initialBalance + Σ(entrate) - Σ(uscite)
  const totals = await prisma.transaction.groupBy({
    by: ["bankAccountId", "type"],
    where: { holderId },
    _sum: { amount: true },
  });
  const balances = new Map<string, number>();
  for (const a of accounts) balances.set(a.id, a.initialBalance);
  for (const t of totals) {
    const sign = t.type === "income" ? 1 : -1;
    balances.set(
      t.bankAccountId,
      (balances.get(t.bankAccountId) || 0) + sign * (t._sum.amount || 0),
    );
  }

  const rows: ContoRow[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    notes: a.notes,
    bank: a.bank,
    initialBalance: a.initialBalance,
    iban: a.iban,
    cardMaskedPan: a.cardMaskedPan,
    saldo: balances.get(a.id) ?? 0,
    txCount: a._count.transactions,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Anagrafica</div>
          <h1 className="text-xl font-semibold tracking-tight">Conti & Carte</h1>
        </div>
        <div className="text-xs text-sub">{rows.length} conti</div>
      </div>

      <ContiClient rows={rows} />
    </div>
  );
}
