import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { ConnectFormClient } from "@/components/banche/ConnectFormClient";

export default async function CollegaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id!;
  const active = await getActiveHolder(userId);

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { holderId: active.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // I BankAccount che hanno già una BankConnection attiva: li mostriamo
  // disabilitati nel dropdown per evitare connessioni duplicate.
  const alreadyConnected = await prisma.bankConnection.findMany({
    where: { holderId: active.id, status: { in: ["active", "expiring", "error"] } },
    select: { bankAccountId: true, aspspName: true },
  });
  const connectedMap = new Map(
    alreadyConnected.map((c) => [c.bankAccountId, c.aspspName]),
  );

  const bankAccountsForUi = bankAccounts.map((ba) => ({
    id: ba.id,
    name: ba.name,
    alreadyConnectedTo: connectedMap.get(ba.id) ?? null,
  }));

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs text-sub">
          <Link href="/impostazioni" className="hover:underline">
            Impostazioni
          </Link>{" "}
          /{" "}
          <Link href="/impostazioni/banche" className="hover:underline">
            Banche
          </Link>{" "}
          / Collega nuovo conto
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Collega un conto bancario
        </h1>
      </div>

      <div className="panel p-4 mb-4 text-xs text-sub leading-relaxed">
        <span className="font-medium text-ink">Cosa succede dopo:</span> sarai
        reindirizzato alla tua banca per autenticarti (login + 2FA) e dare il
        consenso PSD2 di 6 mesi all&apos;applicazione. Una volta tornato qui, la
        nuova connessione sarà visibile nella lista e potrai sincronizzare le
        transazioni.
      </div>

      <ConnectFormClient bankAccounts={bankAccountsForUi} />
    </div>
  );
}
