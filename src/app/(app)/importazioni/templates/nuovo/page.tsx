import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveHolder } from "@/lib/holder";
import { TemplateForm } from "@/components/importazioni/TemplateForm";

export default async function NuovoTemplatePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const holder = await getActiveHolder(session.user.id!);
  const holderId = holder.id;

  const [accounts, categories, paymentMethods] = await Promise.all([
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-sub">
            <Link href="/importazioni/templates" className="hover:underline">
              Template di import
            </Link>{" "}
            / Nuovo
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Nuovo template</h1>
        </div>
      </div>

      <TemplateForm
        accounts={accounts}
        categoriesExpense={categories.filter((c) => c.type === "expense")}
        categoriesIncome={categories.filter((c) => c.type === "income")}
        paymentMethods={paymentMethods}
      />
    </div>
  );
}
