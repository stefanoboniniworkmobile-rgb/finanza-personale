import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveHolder } from "@/lib/holder";
import { BancheClient } from "@/components/banche/BancheClient";
import { SyncJobsPoller } from "@/components/banche/SyncJobsPoller";

export default async function BanchePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id!;
  const active = await getActiveHolder(userId);
  const params = await searchParams;
  // Job di sync da pollare (arrivano da /api/psd2/match dopo l'abbinamento)
  const jobsParam = typeof params.jobs === "string" ? params.jobs : "";
  const jobIds = jobsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Se ci sono job in corso, il poller si occupa di mostrare il banner.
  // Altrimenti mostriamo un toast statico per i flussi senza polling
  // (es. ritorno da error o da altre azioni).
  const initialMessage =
    params.status === "connected" && jobIds.length === 0
      ? {
          kind: "ok" as const,
          msg: `✓ Connessione creata. ${typeof params.note === "string" ? params.note : "Ora puoi sincronizzare le transazioni."}`,
        }
      : null;

  // BankConnection dell'Holder attivo, con dati di contesto
  const connections = await prisma.bankConnection.findMany({
    where: { holderId: active.id },
    include: {
      bankAccount: { select: { id: true, name: true } },
      _count: { select: { transactions: true } },
    },
    orderBy: [{ status: "asc" }, { aspspName: "asc" }],
  });

  // BankAccount disponibili (per il pulsante "collega nuovo conto")
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { holderId: active.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Serializza date in stringhe ISO per passarle al client component
  const rows = connections.map((c) => ({
    id: c.id,
    bankAccountId: c.bankAccountId,
    bankAccountName: c.bankAccount.name,
    aspspName: c.aspspName,
    aspspCountry: c.aspspCountry,
    provider: c.provider,
    status: c.status,
    errorMessage: c.errorMessage,
    validUntilIso: c.validUntil.toISOString(),
    lastSyncAtIso: c.lastSyncAt?.toISOString() ?? null,
    lastSyncedTxDateIso: c.lastSyncedTxDate?.toISOString() ?? null,
    txCount: c._count.transactions,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">
            <Link href="/impostazioni" className="hover:underline">
              Impostazioni
            </Link>{" "}
            / Banche
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Banche connesse
          </h1>
        </div>
        <Link href="/impostazioni/banche/collega" className="btn">
          + Collega nuovo conto
        </Link>
      </div>

      <div className="panel p-4 mb-4 text-xs text-sub leading-relaxed">
        <span className="font-medium text-ink">Come funziona.</span> Ogni
        connessione PSD2 collega un tuo conto bancario all&apos;app via Open
        Banking (Enable Banking come AISP). Il consenso dura 180 giorni come da
        normativa, poi va rinnovato. I sync importano solo le transazioni nuove
        rispetto a quelle che già hai (niente duplicati con lo storico Excel).
      </div>

      {jobIds.length > 0 && <SyncJobsPoller jobIds={jobIds} />}

      <BancheClient
        rows={rows}
        bankAccounts={bankAccounts}
        initialMessage={initialMessage}
      />
    </div>
  );
}
