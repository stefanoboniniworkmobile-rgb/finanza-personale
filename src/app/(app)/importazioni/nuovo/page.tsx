import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveHolder } from "@/lib/holder";
import { ImportFlow } from "@/components/importazioni/ImportFlow";

export default async function NuovoImportPage({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;
  const sp = await searchParams;

  const [templates, accounts, categories, paymentMethods] = await Promise.all([
    prisma.importTemplate.findMany({
      where: { holderId },
      select: { id: true, name: true, fileType: true, sourceLabel: true },
      orderBy: { name: "asc" },
    }),
    prisma.bankAccount.findMany({
      where: { holderId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      where: { holderId },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.paymentMethod.findMany({
      where: { holderId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (templates.length === 0) {
    redirect("/importazioni/templates/nuovo");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">
            <Link href="/importazioni" className="hover:underline">
              Importazioni
            </Link>{" "}
            / Nuovo
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Importa movimenti</h1>
        </div>
      </div>

      <ImportFlow
        templates={templates}
        initialTemplateId={sp.templateId}
        accounts={accounts}
        categoriesExpense={categories.filter((c) => c.type === "expense")}
        categoriesIncome={categories.filter((c) => c.type === "income")}
        paymentMethods={paymentMethods}
      />
    </div>
  );
}
