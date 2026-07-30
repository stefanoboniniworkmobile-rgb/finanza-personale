import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveHolder } from "@/lib/holder";
import { TemplateListActions } from "@/components/importazioni/TemplateListActions";

export default async function ImportTemplatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);

  const templates = await prisma.importTemplate.findMany({
    where: { holderId: holder.id },
    include: {
      defaultBankAccount: { select: { id: true, name: true } },
      _count: { select: { mappings: true, batches: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">Importazioni</div>
          <h1 className="text-xl font-semibold tracking-tight">Template di import</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/importazioni" className="btn-ghost">
            Storico import
          </Link>
          <Link href="/importazioni/templates/nuovo" className="btn">
            + Nuovo template
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="panel p-8 text-center">
          <div className="text-base font-medium mb-1">Nessun template configurato</div>
          <div className="text-sm text-sub mb-4">
            Crea un template per ogni fonte (banca, carta, e-wallet) per importare gli estratti in modo ripetibile.
          </div>
          <Link href="/importazioni/templates/nuovo" className="btn">
            Crea il primo template
          </Link>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-line">
              <tr className="text-left text-xs uppercase tracking-wider text-sub">
                <th className="px-4 py-2.5 font-semibold">Nome</th>
                <th className="px-4 py-2.5 font-semibold">Tipo file</th>
                <th className="px-4 py-2.5 font-semibold">Segno</th>
                <th className="px-4 py-2.5 font-semibold">Conto di default</th>
                <th className="px-4 py-2.5 font-semibold text-right">Mappings</th>
                <th className="px-4 py-2.5 font-semibold text-right">Import fatti</th>
                <th className="px-4 py-2.5 font-semibold text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-line2 last:border-b-0 hover:bg-bg/50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/importazioni/templates/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.name}
                    </Link>
                    {t.sourceLabel && (
                      <div className="text-[11px] text-sub">{t.sourceLabel}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="pill bg-line2 text-sub uppercase text-[10px]">
                      {t.fileType}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-sub">
                    {signModeLabel(t.signMode)}
                  </td>
                  <td className="px-4 py-2.5 text-[13px]">
                    {t.defaultBankAccount?.name ?? <span className="text-sub">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right num-mono">{t._count.mappings}</td>
                  <td className="px-4 py-2.5 text-right num-mono">{t._count.batches}</td>
                  <td className="px-4 py-2.5 text-right">
                    <TemplateListActions templateId={t.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function signModeLabel(s: string): string {
  switch (s) {
    case "SIGNED":
      return "Colonna unica con segno";
    case "DEBIT_CREDIT":
      return "Dare / Avere";
    case "AMOUNT_PLUS_TYPE":
      return "Importo + tipo";
    default:
      return s;
  }
}
