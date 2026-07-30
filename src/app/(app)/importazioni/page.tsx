import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveHolder } from "@/lib/holder";
import { HashDiagnostics } from "@/components/importazioni/HashDiagnostics";

export default async function ImportazioniPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;

  const [batches, templatesCount, totalTransactions, withHash] = await Promise.all([
    prisma.importBatch.findMany({
      where: { holderId },
      include: { template: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.importTemplate.count({ where: { holderId } }),
    prisma.transaction.count({ where: { holderId } }),
    prisma.transaction.count({ where: { holderId, importHash: { not: null } } }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Strumenti</div>
          <h1 className="text-xl font-semibold tracking-tight">Importazioni</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/importazioni/templates" className="btn-ghost">
            Template ({templatesCount})
          </Link>
          <Link
            href="/importazioni/nuovo"
            className={`btn ${templatesCount === 0 ? "opacity-50 pointer-events-none" : ""}`}
          >
            + Nuovo import
          </Link>
        </div>
      </div>

      {templatesCount === 0 && (
        <div className="panel p-6 mb-4 bg-amber-50/40 border-amber-200">
          <div className="text-sm font-medium mb-1">Crea prima un template</div>
          <div className="text-sm text-sub mb-3">
            Un template descrive come leggere i file di una fonte (banca, carta, e-wallet). Una volta creato lo riusi ad ogni import.
          </div>
          <Link href="/importazioni/templates/nuovo" className="btn">
            Crea il primo template
          </Link>
        </div>
      )}

      <HashDiagnostics totalTransactions={totalTransactions} withHash={withHash} />


      <div className="panel overflow-x-auto">
        <div className="px-4 py-3 border-b border-line2 text-xs uppercase tracking-wider text-sub font-semibold">
          Storico import
        </div>
        {batches.length === 0 ? (
          <div className="p-8 text-center text-sm text-sub">
            Nessun import effettuato.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-line2">
              <tr className="text-left text-xs uppercase tracking-wider text-sub">
                <th className="px-4 py-2 font-semibold">Data</th>
                <th className="px-4 py-2 font-semibold">Template</th>
                <th className="px-4 py-2 font-semibold">File</th>
                <th className="px-4 py-2 font-semibold text-right">Righe</th>
                <th className="px-4 py-2 font-semibold text-right">Importati</th>
                <th className="px-4 py-2 font-semibold text-right">Duplicati</th>
                <th className="px-4 py-2 font-semibold text-right">Errori</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-line2 last:border-b-0">
                  <td className="px-4 py-2 text-[12px] text-sub">
                    {b.createdAt.toLocaleString("it-IT")}
                  </td>
                  <td className="px-4 py-2">
                    {b.template ? (
                      <Link
                        href={`/importazioni/templates/${b.template.id}`}
                        className="hover:underline"
                      >
                        {b.template.name}
                      </Link>
                    ) : (
                      <span className="text-sub">— eliminato —</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[12px]">{b.fileName}</td>
                  <td className="px-4 py-2 text-right num-mono">{b.totalRows}</td>
                  <td className="px-4 py-2 text-right num-mono text-ok-600">
                    {b.importedCount}
                  </td>
                  <td className="px-4 py-2 text-right num-mono text-sub">
                    {b.duplicateCount}
                  </td>
                  <td className="px-4 py-2 text-right num-mono text-err-600">
                    {b.errorCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
