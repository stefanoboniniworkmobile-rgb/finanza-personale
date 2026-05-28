import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getActiveHolder } from "@/lib/holder";
import {
  ModalitaClient,
  type ModalitaRow,
} from "@/components/modalita/ModalitaClient";

export default async function ModalitaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);

  const items = await prisma.paymentMethod.findMany({
    where: { holderId: holder.id },
    include: { _count: { select: { transactions: true } } },
    orderBy: { name: "asc" },
  });

  const rows: ModalitaRow[] = items.map((m) => ({
    id: m.id,
    name: m.name,
    notes: m.notes,
    txCount: m._count.transactions,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Anagrafica</div>
          <h1 className="text-xl font-semibold tracking-tight">
            Modalità di pagamento
          </h1>
        </div>
        <div className="text-xs text-sub">{rows.length} modalità</div>
      </div>

      <ModalitaClient rows={rows} />

      <div className="mt-4 panel p-4 text-xs text-sub leading-relaxed">
        <span className="font-medium text-ink">Nota.</span> Eliminare una
        modalità non cancella i movimenti collegati: la loro modalità di
        pagamento viene azzerata e potrai assegnarne un'altra in futuro.
      </div>
    </div>
  );
}
